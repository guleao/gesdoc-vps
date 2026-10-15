// Envio ao Atlas, MODO SIMULAÇÃO. Não anexa arquivo e não clica em "Salvar e enviar".
//
// O que faz:
//   1. Lê do Neon as pendências do robô (aba preenchida) em COMPOSTO ou LOCALIZADO.
//   2. Acha o document_schedule_id de cada uma na última coleta local (out/atlas.db), pela mesma chave do neon.js.
//   3. Localiza o arquivo em disco (caminho_origem, ou <pasta>/factorial/<id>/... se o caminho veio de outra máquina)
//      e confere extensão (.pdf/.zip, o que o portal aceita), tamanho e SHA-256 contra o que está no Neon.
//   4. Mostra o que enviaria e grava out/enviar-simulacao.json.
//   5. Com --abrir [N], abre a tela de envio das N primeiras com document_schedule_id (prontas primeiro; padrão 1) só para conferir que é o documento certo,
//      que existe o campo de arquivo e que "Salvar e enviar" está desabilitado. Não anexa nada.
//
// Uso:
//   node enviar.js                    lista
//   node enviar.js --id 129           só essa pendência do Neon
//   node enviar.js --abrir 3          lista e abre a tela das 3 primeiras prontas
// Opções: --pasta <raiz dos downloads> (padrão FACTORIAL_PASTA_DOWNLOAD ou out/downloads)
//
// O envio de verdade (--enviar) NÃO está implementado: depende de aprovação e de conhecer a chamada de API do portal.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { DatabaseSync } = require('node:sqlite');
const { conexao } = require('./neon');
const { APP, OUT, log, abrir, garantirLogin, dormir } = require('./comum');

const DB = process.env.ATLAS_DB || path.join(__dirname, 'out', 'atlas.db');
const ACEITA = new Set(['.pdf', '.zip']);

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const digitos = (s) => (s ? String(s).replace(/\D/g, '') : '');
const dia = (d) => (d == null ? '' : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
// Mesma pendência entre Neon e coleta local: documento, CPF, CNPJ, pedido, unidade, competência e prazo.
const chave = (r) => [normalizar(r.nome), digitos(r.cpf), digitos(r.cnpj_filial), r.pedido, normalizar(r.unidade), r.competencia, dia(r.prazo_envio)].join('|');

function idsDaColeta() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const coleta = db.prepare('SELECT id FROM coletas ORDER BY id DESC LIMIT 1').get();
  if (!coleta) throw new Error('Nenhuma coleta no banco local. Rode node pendencias.js antes.');
  const linhas = db.prepare(`SELECT documento, cpf, cnpj_filial, pedido, unidades, competencia, prazo_envio, document_schedule_id FROM pendencias WHERE coleta_id = ? AND aba <> 'Reprovados'`).all(coleta.id);
  db.close();
  const mapa = new Map();
  for (const l of linhas) mapa.set(chave({ nome: l.documento, cpf: l.cpf, cnpj_filial: l.cnpj_filial, pedido: l.pedido, unidade: l.unidades, competencia: l.competencia, prazo_envio: l.prazo_envio }), l.document_schedule_id);
  return { mapa, coletaId: coleta.id };
}

// Caminho gravado por outra máquina (ex.: "downloads\factorial\120\doc9_...pdf") vira <pasta>/factorial/120/doc9_...pdf.
function acharArquivo(caminho, pasta) {
  if (!caminho) return { erro: 'sem caminho_origem' };
  if (/^factorial:/i.test(caminho)) return { erro: 'ainda não baixado (só referência da Factorial)' };
  const norm = caminho.replace(/\\/g, '/');
  const candidatos = [caminho];
  const i = norm.toLowerCase().indexOf('factorial/');
  if (i >= 0) candidatos.push(path.join(pasta, ...norm.slice(i).split('/')));
  candidatos.push(path.join(pasta, path.basename(norm)));
  for (const c of candidatos) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { arquivo: c };
  return { erro: 'arquivo não encontrado neste computador' };
}

function conferir(arquivo, linha) {
  const ext = path.extname(arquivo).toLowerCase();
  const dados = fs.readFileSync(arquivo);
  const hash = crypto.createHash('sha256').update(dados).digest('hex');
  const avisos = [];
  if (!ACEITA.has(ext)) avisos.push(`extensão ${ext || '(nenhuma)'} não aceita pelo portal`);
  if (ext === '.pdf' && dados.subarray(0, 5).toString('latin1') !== '%PDF-') avisos.push('não parece um PDF');
  if (linha.tamanho_bytes != null && Number(linha.tamanho_bytes) !== dados.length) avisos.push(`tamanho difere do Neon (${dados.length} x ${linha.tamanho_bytes})`);
  if (linha.hash_arquivo && linha.hash_arquivo !== hash) avisos.push('SHA-256 difere do Neon');
  return { tamanho: dados.length, hash, avisos };
}

// Abre a tela de envio e confere, sem anexar nada.
async function abrirTela(prontas) {
  const { ctx, page } = await abrir();
  const res = [];
  try {
    await garantirLogin(page, '/dashboard/provider');
    for (const p of prontas) {
      await page.goto(`${APP}/document-schedule/${p.schedule_id}/general-information?resume=false`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 30000 }).catch(() => {});
      await dormir(1500);
      const titulo = (await page.locator('text=/^Documento - /').first().innerText().catch(() => '')).replace(/^Documento - /, '').trim();
      const campoArquivo = await page.locator('input[type=file]').count();
      const botao = page.locator('button:has-text("Salvar e enviar")').first();
      const achouBotao = (await botao.count()) > 0;
      const classeBotao = achouBotao ? (await botao.getAttribute('class', { timeout: 3000 }).catch(() => '')) || '' : '';
      const desabilitado = achouBotao ? (/disabled/.test(classeBotao) || (await botao.isDisabled().catch(() => false))) : null;
      const r = { id: p.id, titulo_portal: titulo, documento_neon: p.nome, titulo_confere: normalizar(titulo) === normalizar(p.nome), campo_arquivo: campoArquivo > 0, botao_encontrado: achouBotao, botao_desabilitado: desabilitado };
      log(`Tela ${p.id}: "${titulo}" | confere: ${r.titulo_confere} | campo de arquivo: ${r.campo_arquivo} | botão desabilitado: ${r.botao_desabilitado}`);
      res.push(r);
    }
  } finally {
    await ctx.close();
  }
  return res;
}

(async () => {
  const args = process.argv.slice(2);
  const opc = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--enviar') opc.enviar = true;
    else if (args[i] === '--abrir') opc.abrir = /^\d+$/.test(args[i + 1] || '') ? Number(args[++i]) : 1;
    else if (args[i].startsWith('--')) opc[args[i].slice(2)] = args[++i];
  }
  if (opc.enviar) {
    console.error('O envio de verdade ainda não está implementado. Este script só simula.');
    process.exitCode = 2;
    return;
  }
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (defina ROBO_DATABASE_URL ou ROBO_ENV_FILE).');
  const pasta = opc.pasta || process.env.FACTORIAL_PASTA_DOWNLOAD || path.join(__dirname, 'out', 'downloads');
  const { mapa, coletaId } = idsDaColeta();
  const filtro = opc.id ? 'and id = $2' : '';
  const linhas = await neon(url).query(
    `select id, doc_id, nome, cpf, cnpj_filial, numero_pedido, unidade, competencia, prazo_envio, estado, caminho_origem, tamanho_bytes, hash_arquivo
     from documentos where aba is not null and estado = any($1) ${filtro} order by id`,
    opc.id ? [['COMPOSTO', 'LOCALIZADO'], Number(opc.id)] : [['COMPOSTO', 'LOCALIZADO']],
  );

  const itens = linhas.map((l) => {
    const item = { id: l.id, doc_id: l.doc_id, nome: l.nome, competencia: l.competencia, estado: l.estado, pronta: false, motivos: [] };
    item.schedule_id = mapa.get(chave({ ...l, pedido: l.numero_pedido })) || null;
    if (!item.schedule_id) item.motivos.push(`sem document_schedule_id na coleta ${coletaId} (pendência não aparece mais ou mudou)`);
    const f = acharArquivo(l.caminho_origem, pasta);
    if (f.erro) item.motivos.push(f.erro);
    else {
      Object.assign(item, { arquivo: f.arquivo }, conferir(f.arquivo, l));
      item.motivos.push(...item.avisos);
    }
    item.pronta = !!item.schedule_id && !!item.arquivo && !item.avisos?.length;
    return item;
  });

  const prontas = itens.filter((i) => i.pronta);
  log(`${itens.length} pendência(s) COMPOSTO/LOCALIZADO no Neon; ${prontas.length} pronta(s) para enviar; ${itens.length - prontas.length} com pendência de arquivo ou id.`);
  for (const i of itens) {
    const o = i.pronta ? 'PRONTA' : 'NÃO   ';
    console.log(`  ${o} #${i.id} ${i.estado} doc_id ${i.doc_id} ${i.nome} (${i.competencia})${i.pronta ? ` -> ${path.basename(i.arquivo)} ${i.tamanho} bytes` : ` -- ${i.motivos.join('; ')}`}`);
  }
  const porMotivo = {};
  for (const i of itens) if (!i.pronta) for (const m of i.motivos) porMotivo[m.replace(/\(.*\)/, '').trim()] = (porMotivo[m.replace(/\(.*\)/, '').trim()] || 0) + 1;
  if (Object.keys(porMotivo).length) log('Motivos: ' + Object.entries(porMotivo).map(([m, n]) => `${n}x ${m}`).join(' | '));

  let telas = [];
  if (opc.abrir) {
    // A conferência da tela não precisa do arquivo: abre as primeiras com document_schedule_id (prontas primeiro).
    const comTela = [...prontas, ...itens.filter((i) => !i.pronta && i.schedule_id)].slice(0, opc.abrir);
    if (!comTela.length) log('Nenhuma pendência com document_schedule_id; não abri o portal.');
    else telas = await abrirTela(comTela);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'enviar-simulacao.json'), JSON.stringify({ gerado_em: new Date().toISOString(), coleta: coletaId, pasta, itens, telas }, null, 2), 'utf8');
  log('Simulação: nada foi anexado nem enviado. Detalhes em out/enviar-simulacao.json');
})().catch((e) => {
  console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exitCode = e.codigo || 1;
});
