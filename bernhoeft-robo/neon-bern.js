// Passo 4 (10/11): grava no Neon (tabela documentos, portal = 'Bernhoeft') cada documento do relatório 012 que o pendencias.js
// leu, com as mesmas colunas do robô Atlas, e uma linha por leitura em coletas. Só grava; não toca no portal.
//   - Qual documento é: documento_regras com destino Bernhoeft e nome = descrição do 012 ("EQT - Brigada de Incêndio ...").
//     Descrição sem regra = pulada e listada no log (as regras entram por SQL do owner: docs/sql/2026-11-10-regras-bernhoeft.sql).
//   - Mesma pendência entre leituras = portal_item_id (a chave do 012: contrato|contratada|competência|área|documento|...).
//   - Aberto no portal = status "Não Entregue". "Não Analisado" = enviado, em análise; "Analisado" = aprovado.
//   - Motivo de cada aberto: o que a esteira do painel achou (PACOTES/auto/estado.json) e a confiança mínima do automático.
// Conexão: ROBO_DATABASE_URL (a mesma role do robô Atlas, robo_atlas). Sem ela, nada é gravado.
'use strict';
const fs = require('fs');
const path = require('path');

const PORTAL = 'Bernhoeft';
const CLIENTE = 'Equatorial';
const lerJson = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const semUrl = (s) => String(s ?? '').replace(/postgres(ql)?:\/\/\S+/g, '<url>');
const NIVEL = { baixa: 1, media: 2, alta: 3 };

// Status do 012 -> vocabulário do ODA (o mesmo do robô Atlas). O 012 não traz prazo: "Não Entregue" conta como atrasado.
const SITUACAO = { 'nao entregue': 'ATRASADO', 'nao analisado': 'EM_ANALISE', analisado: 'APROVADO' }; // chaves sem acento (norm)
const situacaoPortal = (status) => SITUACAO[norm(status)] || 'ATRASADO';
const aberto = (status) => norm(status) === 'nao entregue';

// Motivo de um "Não Entregue" pela esteira (mesmos códigos do atlas-robo/eventos.js).
function motivoDaEsteira(item, esteira, confiancaMin) {
  const e = esteira.get(item.chave);
  if (!e) return { motivo: 'sem_robo', responsavel: 'sistema', texto: 'a esteira do painel ainda não avaliou este documento' };
  if (e.estado === 'pronto') {
    if ((NIVEL[e.confianca] || 0) < (NIVEL[confiancaMin] || 3)) {
      return { motivo: 'confianca_baixa', responsavel: 'operacao', texto: `arquivo achado, mas com confiança ${e.confianca || '?'} (o automático só envia a partir de ${confiancaMin}): ${e.motivo || 'conferir o PDF'}` };
    }
    return { motivo: 'pronto', responsavel: 'sistema', texto: 'pronto: sai no envio automático' };
  }
  if (/sem regra de busca/i.test(e.motivo || '')) return { motivo: 'sem_robo', responsavel: 'sistema', texto: e.motivo };
  return { motivo: 'falta_arquivo', responsavel: 'cliente', texto: e.motivo || 'nenhum arquivo deste tipo nos pacotes' };
}

// Pedido do 012 que gerou os dados (o mais recente Concluido) e se é de hoje.
function info012(rel) {
  const pedidos = rel?.pedidos || [];
  const ok = pedidos.find((p) => /conclu/i.test(p.status || ''));
  const ultimo = pedidos[0] || null;
  return { usado: ok?.solicitado_em || null, ultimo_pedido: ultimo ? { status: ultimo.status, solicitado_em: ultimo.solicitado_em } : null,
    lido_agora: !!rel?.documentos_por_status };
}

async function conectar() {
  const url = process.env.ROBO_DATABASE_URL;
  if (!url) return null;
  const { neon } = require('@neondatabase/serverless');
  return neon(url);
}

// doc = o objeto gravado em out/pendencias.json. Devolve um resumo (ou null sem conexão).
async function gravar({ doc, inicio = null, log = console.log, sql: sqlTeste = null, pacotes = process.env.PACOTES, dirEnvio = null } = {}) {
  const sql = sqlTeste || (await conectar());
  if (!sql) return null;
  const itens = (doc?.itens || []).filter((i) => String(i.chave || '').startsWith('doc:'));
  const regras = new Map((await sql.query(`select doc_id, nome from documento_regras where ativo and destino ilike '%bernhoeft%'`)).map((r) => [norm(r.nome), r.doc_id]));
  const existentes = new Map((await sql.query(`select id, portal_item_id, estado from documentos where portal = $1`, [PORTAL])).map((r) => [r.portal_item_id, r]));
  const est = pacotes ? lerJson(path.join(pacotes, 'auto', 'estado.json')) : null;
  const esteira = new Map((est?.itens || []).map((e) => [e.pendencia?.chave, e]).filter(([k]) => k));
  const modo = lerJson(path.join(dirEnvio || path.join(__dirname, 'out', 'envio'), 'modo.json')) || {};
  const confiancaMin = NIVEL[modo.confianca] ? modo.confianca : 'alta';

  const consultas = [];
  const semRegra = new Map();
  const vistos = new Set();
  let novos = 0, atualizados = 0;
  const motivos = [];
  for (const i of itens) {
    const doc_id = regras.get(norm(i.descricao));
    if (!doc_id) { semRegra.set(i.descricao, (semRegra.get(i.descricao) || 0) + 1); continue; }
    if (vistos.has(i.chave)) continue;
    vistos.add(i.chave);
    const ab = aberto(i.status);
    const m = ab ? motivoDaEsteira(i, esteira, confiancaMin) : { motivo: null, responsavel: null };
    const r = {
      doc_id, cliente: CLIENTE, unidade: i.unidade || null, nome: i.descricao, categoria: i.competencia || null,
      aba: i.status || null, situacao: i.status || null, tipo: i.tipo || null, grupo: i.area || null,
      // contrato + área: o mesmo documento aparece em duas áreas do mesmo contrato (e a chave natural do banco não tem área)
      numero_pedido: `${i.contrato}${i.area ? ' · ' + i.area : ''}`,
      portal: PORTAL, portal_item_id: i.chave, status_portal: i.status || null, situacao_portal: situacaoPortal(i.status),
      aberto_no_portal: ab, visto_no_portal_em: doc.coletado_em || null, motivo: m.motivo, responsavel: m.responsavel,
    };
    const ex = existentes.get(i.chave);
    if (ex) {
      atualizados++;
      // Estado: fechou no portal = ENVIADO; voltou a "Não Entregue" depois de enviado = PENDENTE_ENVIO. Os outros ficam.
      const estado = !ab && ['PENDENTE_ENVIO', 'LOCALIZADO', 'COMPOSTO'].includes(ex.estado) ? 'ENVIADO' : ab && ex.estado === 'ENVIADO' ? 'PENDENTE_ENVIO' : ex.estado;
      const cols = Object.keys(r);
      // motivo_em: o lado direito do SET lê o motivo ANTES da troca, então compara o antigo com o novo.
      consultas.push(sql.query(`update documentos set ${cols.map((c, k) => (c === 'motivo' ? `${c} = $${k + 1}::varchar` : `${c} = $${k + 1}`)).join(', ')}, estado = $${cols.length + 1},
        motivo_em = case when motivo is distinct from $${cols.indexOf('motivo') + 1}::varchar then now() else motivo_em end, atualizado_em = now()
        where id = $${cols.length + 2}`, [...cols.map((c) => r[c]), estado, ex.id]));
    } else {
      novos++;
      const row = { ...r, estado: ab ? 'PENDENTE_ENVIO' : 'ENVIADO', motivo_em: m.motivo ? new Date().toISOString() : null };
      const cols = Object.keys(row);
      consultas.push(sql.query(`insert into documentos (${cols.join(', ')}) values (${cols.map((_, k) => `$${k + 1}`).join(', ')})
        on conflict (cliente, doc_id, cpf, cnpj_filial, competencia, nome, numero_pedido, prazo_envio) do nothing`, cols.map((c) => row[c])));
    }
    if (ab) motivos.push(m.motivo);
  }
  // Saiu do 012 (só quando os documentos foram lidos agora; com o xlsx velho, nada sai)
  const lidoAgora = !!doc?.relatorio012?.documentos_por_status;
  let saidos = 0;
  if (lidoAgora) {
    for (const [chave, ex] of existentes) {
      if (vistos.has(chave)) continue;
      saidos++;
      consultas.push(sql.query(`update documentos set aberto_no_portal = false, situacao_portal = 'FORA_DO_PORTAL', aba = 'Fora do portal',
        atualizado_em = now() where id = $1 and aberto_no_portal is distinct from false`, [ex.id]));
    }
  }
  const r012 = info012(doc?.relatorio012);
  const totais = { itens: itens.length, gravadas: vistos.size, sem_regra: [...semRegra.values()].reduce((a, b) => a + b, 0), novos, atualizados, saidos,
    nao_entregue: itens.filter((i) => aberto(i.status)).length, por_status: itens.reduce((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {}),
    relatorio_012: r012, coletado_em: doc?.coletado_em || null,
    aviso: r012.lido_agora ? null : `documentos do 012 de ${r012.usado || '?'}: o pedido de hoje não trouxe conteúdo (${r012.ultimo_pedido?.status || '?'})` };
  consultas.push(sql.query(`insert into coletas (portal, inicio, fim, ok, totais) values ($1, $2, $3, true, $4::jsonb)`,
    [PORTAL, inicio || doc?.coletado_em || new Date().toISOString(), doc?.coletado_em || new Date().toISOString(), JSON.stringify(totais)]));
  await sql.transaction(consultas);
  const pm = motivos.reduce((a, x) => ((a[x] = (a[x] || 0) + 1), a), {});
  log(`Neon: ${vistos.size} documento(s) do 012 gravados (${novos} novo(s), ${atualizados} atualizado(s), ${saidos} saíram); abertos: ${totais.nao_entregue} ${JSON.stringify(pm)}.`);
  for (const [d, n] of semRegra) log(`  Neon: sem regra (pulado): ${n}x ${d}`);
  if (totais.aviso) log(`  Neon: ${totais.aviso}`);
  return totais;
}

// Leitura que falhou (login, portal fora): linha em coletas com ok = false.
async function gravarFalha({ inicio, erro, sql: sqlTeste = null } = {}) {
  const sql = sqlTeste || (await conectar());
  if (!sql) return false;
  await sql.query('insert into coletas (portal, inicio, fim, ok, erro) values ($1, $2, now(), false, $3)', [PORTAL, inicio || new Date().toISOString(), semUrl(erro).slice(0, 2000)]);
  return true;
}

module.exports = { gravar, gravarFalha, situacaoPortal, motivoDaEsteira };
