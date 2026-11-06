// Baixa a "planilha" de pendências do Atlas (tela Documentos > Acompanhamento de entregas) pela API e grava
// numa tabela SQLite. SOMENTE LEITURA no portal.
// Não usa o botão "Exportar relatório": ele não baixa arquivo, manda a planilha por e-mail ao dono da conta.
//
// Abas lidas (main_status da API): 0 Atrasados, 1 Próximas entregas, 2 Reprovados. Entregues (3) fica de fora.
// Saídas:
//   out/atlas.db         tabelas "coletas" (uma linha por execução) e "pendencias" (linhas de cada coleta)
//   out/pendencias.xlsx  a planilha da última coleta (Resumo + uma aba por situação; ver planilha.js)
//                        (no Windows, copiada também para "Área de Trabalho\Pendencias Atlas.xlsx")
//   out/pendencias.csv   o mesmo em CSV
//   out/pendencias.json  idem, em JSON
//   Neon                 tabela "documentos", se houver ROBO_DATABASE_URL ou ROBO_ENV_FILE (ver neon.js)
// Uso: node pendencias.js
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { OUT, log, abrir, garantirLogin, esperarToken, api, apiPost } = require('./comum');
const { gerarPlanilha } = require('./planilha');
const { enviarNeon, temConexao } = require('./neon');

const ABAS = { 0: 'Atrasados', 1: 'Próximas entregas', 2: 'Reprovados' };
const POR_PAGINA = 100;
const DB = process.env.ATLAS_DB || path.join(OUT, 'atlas.db');
// Cópia da planilha para fácil acesso. No Windows, padrão = Área de Trabalho; PLANILHA_COPIA=0 desliga.
const COPIA = process.env.PLANILHA_COPIA === '0' ? null
  : process.env.PLANILHA_COPIA || (process.platform === 'win32' ? path.join(require('os').homedir(), 'Desktop', 'Pendencias Atlas.xlsx') : null);

// Mesmo corpo que a tela envia; secondary_status 5 = "Todos".
const filtro = (main_status, skip) => ({
  _page: skip / POR_PAGINA, skip, take: POR_PAGINA,
  document_name: '', employee_name: '', cpf: '', order_number: '',
  delivery_kinds: [], organizations_ids: [], branch_company_ids: [], buildings_ids: [], categories_ids: [], document_groups: [],
  organization_documents: null, order: null, main_status, secondary_status: 5,
});

// Observação: os Reprovados também aparecem em Atrasados (status DelayRejected), como na tela.
const TIPO = { Recurrent: 'Recorrente', Demobilization: 'Desmobilização', Single: 'Único', Unique: 'Único', Sporadic: 'Esporádico', Periodic: 'Periódico' };
const data = (s) => (s ? s.slice(0, 10) : null);
const nomes = (l) => (l || []).map((x) => x.name).join(', ') || null;
const vazio = (s) => (s && s !== '---' ? s : null);

// Uma linha por item, com as colunas da tela (e da planilha exportada).
function linha(aba, i) {
  return {
    aba,
    status: i.status,
    documento: i.document_name,
    funcionario: vazio(i.employee_name),
    cpf: vazio(i.cpf_number),
    tipo: TIPO[i.delivery_kind] || i.delivery_kind,
    grupos: nomes(i.document_groups),
    cliente: nomes(i.organizations) || i.organization_name,
    unidades: nomes(i.buildings),
    categoria: nomes(i.categories),
    pedido: i.order_number,
    cnpj_filial: i.branch_company,
    n_docs: i.count_docs,
    prazo_envio: data(i.expected_upload_at),
    competencia: i.competency ? i.competency.slice(5, 7) + '/' + i.competency.slice(0, 4) : null,
    enviado_em: i.uploaded_at,
    validado_em: i.validated_at,
    validade: data(i.document_file_validity_at),
    critico: i.is_critical ? 1 : 0,
    document_schedule_id: i.document_schedule_id,
    motivo_reprovacao: null, // preenchidos por lerMotivos() nas reprovadas
    observacao_envio: null,
    bruto: JSON.stringify(i),
  };
}
const COLUNAS = Object.keys(linha('', { organizations: [] }));

function abrirBanco() {
  const db = new DatabaseSync(DB);
  db.exec(`
    CREATE TABLE IF NOT EXISTS coletas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coletado_em TEXT NOT NULL,
      atrasados INTEGER, proximas INTEGER, reprovados INTEGER, entregues INTEGER
    );
    CREATE TABLE IF NOT EXISTS pendencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coleta_id INTEGER NOT NULL REFERENCES coletas(id),
      ${COLUNAS.map((c) => `${c} ${['n_docs', 'critico'].includes(c) ? 'INTEGER' : 'TEXT'}`).join(',\n      ')}
    );
    CREATE INDEX IF NOT EXISTS ix_pendencias_coleta ON pendencias(coleta_id);
    CREATE VIEW IF NOT EXISTS pendencias_atuais AS
      SELECT * FROM pendencias WHERE coleta_id = (SELECT MAX(id) FROM coletas);
  `);
  // Banco de antes de uma coluna nova (ex.: motivo_reprovacao, 28/10): acrescenta sem mexer no que já está gravado.
  const tem = new Set(db.prepare('PRAGMA table_info(pendencias)').all().map((c) => c.name));
  for (const c of COLUNAS) if (!tem.has(c)) db.exec(`ALTER TABLE pendencias ADD COLUMN ${c} TEXT`);
  return db;
}

// Motivo da reprovação: o texto que o cliente escreveu ao reprovar ("validation_message"). A lista não traz; o portal
// busca ao abrir o item, por GET em document-reports/modal/schedules/<id> (conferido em 28/10; o document-files/visualize
// dá 400 sem os outros parâmetros). Vem junto a "observation", que quem enviou escreveu no envio.
// Só leitura. Uma consulta por agendamento reprovado; falha = fica sem motivo e a coleta segue.
const texto = (s) => (s && String(s).trim()) || null;
async function lerMotivos(ctx, linhas) {
  const reprovadas = [...new Set(linhas.filter((l) => /Rejected/.test(l.status || '')).map((l) => l.document_schedule_id).filter(Boolean))];
  const porId = new Map();
  let falhas = 0;
  for (const id of reprovadas) {
    try {
      const r = await api(ctx, `enc/document-reports/modal/schedules/${id}`);
      const d = r?.data || r || {};
      porId.set(id, { motivo: texto(d.validation_message), obs: texto(d.observation) });
    } catch { falhas++; }
  }
  for (const l of linhas) {
    const m = porId.get(l.document_schedule_id);
    l.motivo_reprovacao = m?.motivo || null;
    l.observacao_envio = m?.obs || null;
  }
  const com = [...porId.values()].filter((m) => m.motivo).length;
  log(`Motivo da reprovação: ${com} de ${reprovadas.length} reprovada(s)${falhas ? ` (${falhas} consulta(s) com erro)` : ''}.`);
}

const csv = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { ctx, page } = await abrir();
  try {
    await garantirLogin(page, '/dashboard/provider');
    await esperarToken(ctx);

    const linhas = [];
    const totais = {};
    for (const [status, aba] of Object.entries(ABAS)) {
      let skip = 0;
      let total = 0;
      do {
        const r = await apiPost(ctx, 'enc/document-reports/provider', filtro(Number(status), skip));
        total = r.count;
        for (const i of r.items) linhas.push(linha(aba, i));
        skip += POR_PAGINA;
        if (!r.items.length) break;
      } while (skip < total);
      totais[aba] = total;
      log(`${aba}: ${total}`);
    }
    // Entregues (04/11): a lista inteira, para o neon.js marcar como ENVIADO as linhas que saíram das listas porque foram
    // entregues (pelo robô ou por alguém direto no portal). Fica fora do atlas.db (são milhares por coleta): vai para
    // out/entregues.json, com a hora desta coleta. Falhou = sem lista (o neon.js não marca nada) e a coleta segue.
    let entregues = 0;
    let listaEntregues = null;
    try {
      const itens = [];
      let skip = 0;
      do {
        const r = await apiPost(ctx, 'enc/document-reports/provider', filtro(3, skip));
        entregues = r.count;
        for (const i of r.items) itens.push(linha('Entregues', i));
        skip += POR_PAGINA;
        if (!r.items.length) break;
      } while (skip < entregues);
      if (itens.length >= entregues) listaEntregues = itens.map(({ bruto, ...l }) => l);
      log(`Entregues: ${entregues}${listaEntregues ? '' : ` (lista incompleta: ${itens.length}; não usada)`}`);
    } catch (e) {
      log(`Entregues: lista não lida (${e.message}); o Neon não marca as entregues nesta coleta.`);
      if (!entregues) entregues = (await apiPost(ctx, 'enc/document-reports/provider', { ...filtro(3, 0), take: 1 }).catch(() => ({}))).count ?? null;
    }
    await lerMotivos(ctx, linhas);

    const db = abrirBanco();
    const agora = new Date().toISOString();
    db.exec('BEGIN');
    const { lastInsertRowid: coleta } = db
      .prepare('INSERT INTO coletas (coletado_em, atrasados, proximas, reprovados, entregues) VALUES (?, ?, ?, ?, ?)')
      .run(agora, totais.Atrasados, totais['Próximas entregas'], totais.Reprovados, entregues);
    const ins = db.prepare(`INSERT INTO pendencias (coleta_id, ${COLUNAS.join(', ')}) VALUES (?, ${COLUNAS.map(() => '?').join(', ')})`);
    for (const l of linhas) ins.run(coleta, ...COLUNAS.map((c) => l[c] ?? null));
    db.exec('COMMIT');
    db.close();

    const semBruto = COLUNAS.filter((c) => c !== 'bruto');
    fs.writeFileSync(path.join(OUT, 'pendencias.csv'), '﻿' + [semBruto.join(';'), ...linhas.map((l) => semBruto.map((c) => csv(l[c])).join(';'))].join('\r\n'), 'utf8');
    fs.writeFileSync(path.join(OUT, 'pendencias.json'), JSON.stringify({ coletado_em: agora, totais: { ...totais, Entregues: entregues }, pendencias: linhas.map(({ bruto, ...l }) => l) }, null, 2), 'utf8');
    // Sempre regrava (lista null = coleta sem Entregues): o neon.js só usa a lista da MESMA coleta.
    fs.writeFileSync(path.join(OUT, 'entregues.json'), JSON.stringify({ coletado_em: agora, itens: listaEntregues }), 'utf8');
    log(`${linhas.length} linha(s) gravadas na coleta ${coleta} de ${DB} (e em out/pendencias.csv).`);
    try {
      const { destino } = await gerarPlanilha();
      log(`Planilha: ${destino}`);
      if (COPIA) {
        fs.copyFileSync(destino, COPIA);
        log(`Cópia: ${COPIA}`);
      }
    } catch (e) {
      log(`Planilha não gerada/copiada (${e.message}). Está aberta no Excel?`);
    }
    if (temConexao()) {
      try {
        await enviarNeon({ log, entregues: listaEntregues });
      } catch (e) {
        log(`Neon: não gravado (${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>')}).`);
        process.exitCode = 3;
      }
    }
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exitCode = e.codigo || 1;
  } finally {
    await ctx.close();
  }
})();
