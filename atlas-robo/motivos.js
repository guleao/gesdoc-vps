// Passo 3 (10/11): no fim de cada rodada do robô Atlas, junta o que cada etapa fez e grava no Neon:
//   - documento_eventos: busca e montagem (factorial.js, sharepoint.js), conferência e trava (lista do enviar.js),
//     segurar/soltar (painel ou o próprio robô, pelo out/envio/segurar.json). Só grava quando o resultado muda.
//     O envio é gravado na hora pelo enviar.js (com o protocolo).
//   - documentos.motivo / responsavel / motivo_em de cada pendência ABERTA no Atlas (aberto_no_portal), pela prioridade:
//     enviado e ainda aberto > segurado > lista de envio (pronto/trava/conferência) > reprovado sem arquivo novo > busca >
//     estado deixado pela sincronização > quem deveria buscar.
// Não toca em portal, estado ou arquivo. Uso: node motivos.js [--simular]   (o robo.js roda no fim de cada rodada)
'use strict';
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');
const { conexao } = require('./neon');
const { MOTIVOS, classificar, gravarEventos, atualizarMotivos, temTabela } = require('./eventos');

const OUT = process.env.ATLAS_OUT || path.join(__dirname, 'out');
const DIR_ENVIO = path.join(OUT, 'envio');
const lerJson = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };
const log = (m) => console.log(`[motivos] ${m}`);
// Tipos que a sincronização Factorial (Evilásio) monta; os outros sem robô ficam como "sem_robo".
const DA_SINCRONIZACAO = (process.env.SINC_DOCS || '9,10').split(',').map(Number);
const FEITO_A_MAO = { 66: 'relatório mensal de ocorrências: a Milena baixa o modelo no Atlas e preenche' };

function eventosDaBusca(rel, robo) {
  const ev = [];
  for (const r of rel?.itens || []) {
    if (r.id == null) continue;
    const dados = { doc_id: r.doc_id ?? null, competencia: r.competencia ?? null, unido: !!r.unido };
    if (r.achou) {
      ev.push({ documento_id: r.id, robo, tipo: 'busca', resultado: 'ok', detalhe: r.pasta ? `achado em ${r.pasta}` : 'achado', dados });
      if (r.unido) ev.push({ documento_id: r.id, robo, tipo: 'montagem', resultado: 'ok', detalhe: `unido de ${(r.partes || []).length || 'várias'} parte(s)`, dados });
    } else {
      const tipo = /não uniu|montagem|unir/i.test(r.motivo || '') ? 'montagem' : 'busca';
      const c = classificar(r.motivo, tipo);
      ev.push({ documento_id: r.id, robo, tipo, resultado: 'falha', ...c, detalhe: r.motivo || null, dados });
    }
  }
  return ev;
}

function eventosDaLista(sim) {
  const ev = [];
  for (const i of sim?.itens || []) {
    if (i.id == null) continue;
    const motivos = (i.motivos || []).join('; ');
    const trava = i.segurada || i.acao_portal || i.trava_doc || /mesmo arquivo/.test(motivos);
    if (i.pronta) ev.push({ documento_id: i.id, robo: 'enviar', tipo: 'conferencia', resultado: 'ok', motivo: 'pronto', responsavel: 'sistema', detalhe: 'pode enviar' });
    else {
      const tipo = trava ? 'trava' : 'conferencia';
      ev.push({ documento_id: i.id, robo: 'enviar', tipo, resultado: 'bloqueado', ...classificar(motivos, tipo), detalhe: motivos || null,
        dados: { status_atlas: i.status_atlas ?? null, conteudo: i.conteudo?.bloqueio ?? null } });
    }
  }
  return ev;
}

// Segurar/soltar: compara o segurar.json com o que foi visto na rodada anterior (out/envio/segurar-visto.json).
function eventosSegurar(seg) {
  const arq = path.join(DIR_ENVIO, 'segurar-visto.json');
  const visto = lerJson(arq);
  const ev = [];
  if (visto) {
    for (const [id, s] of Object.entries(seg)) if (!visto[id]) ev.push({ documento_id: Number(id), robo: s.auto ? 'robo' : 'painel', tipo: 'segurar', resultado: 'ok', motivo: 'segurado', responsavel: 'operacao', detalhe: s.motivo || null, dados: { segurado_em: s.em || null }, sempre: true });
    for (const [id, s] of Object.entries(visto)) if (!seg[id]) ev.push({ documento_id: Number(id), robo: 'painel', tipo: 'soltar', resultado: 'ok', detalhe: s.motivo ? `era: ${s.motivo}` : null, sempre: true });
  }
  return { ev, gravarVisto: () => { fs.mkdirSync(DIR_ENVIO, { recursive: true }); fs.writeFileSync(arq, JSON.stringify(seg, null, 2), 'utf8'); } };
}

// Motivo de uma pendência aberta, pela prioridade (ver o cabeçalho).
function motivoDe(d, { seg, sim, buscaF, buscaS }) {
  const m = (codigo, detalhe) => ({ id: d.id, motivo: codigo, responsavel: MOTIVOS[codigo]?.responsavel ?? null, detalhe: detalhe || MOTIVOS[codigo]?.texto });
  const rejeitado = /Rejected/.test(d.status_portal || '') || d.situacao_portal === 'REPROVADO';
  if (d.estado === 'ENVIADO') return rejeitado ? m('reprovado_portal', d.motivo_reprovacao) : m('enviado_aguardando');
  const s = seg[d.id];
  if (s) return /22006|já importado/i.test(s.motivo || '') ? m('reprovado_portal', s.motivo) : m('segurado', s.motivo);
  const i = sim.get(d.id);
  if (i) {
    if (i.pronta) return m('pronto');
    const txt = (i.motivos || []).join('; ');
    const c = classificar(txt, i.acao_portal || i.segurada || i.trava_doc ? 'trava' : 'conferencia');
    return { id: d.id, ...c, detalhe: txt };
  }
  if (d.estado === 'REJEITADO') return m('reprovado_portal', d.motivo_reprovacao);
  const b = [buscaF.get(d.id), buscaS.get(d.id)].filter(Boolean).sort((x, y) => String(y.em || '').localeCompare(String(x.em || '')))[0];
  if (b) {
    if (b.achou) return m('achado_nao_gravado', b.pasta ? `achado em ${b.pasta}` : null);
    return { id: d.id, ...classificar(b.motivo, 'busca'), detalhe: b.motivo };
  }
  if (d.estado === 'AGUARDANDO_ASSINATURA') return m('aguardando_assinatura');
  if (d.estado === 'NAO_ENCONTRADO_FACTORIAL') return m('falta_arquivo', 'não encontrado na Factorial (sincronização)');
  if (d.estado === 'DIVERGENTE_FACTORIAL') return m('pendencia_indevida', 'divergente na Factorial (ex.: empregado ativo)');
  if (d.estado === 'ERRO_COMPOSICAO') return m('erro_montagem');
  if (FEITO_A_MAO[d.doc_id]) return m('definicao_pendente', FEITO_A_MAO[d.doc_id]);
  if (DA_SINCRONIZACAO.includes(Number(d.doc_id))) return m('aguardando_sincronizacao');
  return m('sem_robo');
}

async function consolidar({ sql, simular = false } = {}) {
  if (!(await temTabela(sql, 'documento_eventos'))) { log('sem a tabela documento_eventos: nada a fazer'); return null; }
  const seg = lerJson(path.join(DIR_ENVIO, 'segurar.json')) || {};
  const simJ = lerJson(path.join(OUT, 'enviar-simulacao.json'));
  const relF = lerJson(path.join(DIR_ENVIO, 'busca.json'));
  const relS = lerJson(path.join(DIR_ENVIO, 'busca-sharepoint.json'));
  const comEm = (rel) => new Map((rel?.itens || []).map((r) => [Number(r.id), { ...r, em: r.em || rel.em }]));
  const sim = new Map((simJ?.itens || []).map((i) => [Number(i.id), i]));
  const buscaF = comEm(relF), buscaS = comEm(relS);

  // Eventos (só de documentos que existem no banco: a FK recusaria o resto)
  const segu = eventosSegurar(seg);
  let ev = [...eventosDaBusca(relF, 'factorial'), ...(relS?.modo === 'simulacao' ? [] : eventosDaBusca(relS, 'sharepoint')), ...eventosDaLista(simJ), ...segu.ev];
  const ids = [...new Set(ev.map((e) => Number(e.documento_id)))];
  const existem = new Set(ids.length ? (await sql.query('select id from documentos where id = any($1)', [ids])).map((r) => Number(r.id)) : []);
  ev = ev.filter((e) => existem.has(Number(e.documento_id)));

  // Motivo de cada pendência aberta no Atlas
  const abertas = await sql.query(`select id, doc_id, estado, status_portal, situacao_portal, motivo_reprovacao from documentos
    where coalesce(portal, 'Atlas') = 'Atlas' and aberto_no_portal`);
  const motivos = abertas.map((d) => motivoDe({ ...d, id: Number(d.id) }, { seg, sim, buscaF, buscaS }));
  const porResp = {};
  for (const x of motivos) { const k = `${x.responsavel || '-'}/${x.motivo}`; porResp[k] = (porResp[k] || 0) + 1; }
  log(`${abertas.length} pendência(s) abertas no Atlas: ${Object.entries(porResp).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`);
  if (simular) { log(`simulação: ${ev.length} evento(s) e ${motivos.length} motivo(s) NÃO gravados`); return { ev, motivos }; }
  const nEv = await gravarEventos(sql, ev, { log });
  const nMot = await atualizarMotivos(sql, motivos);
  segu.gravarVisto();
  log(`gravado: ${nEv} evento(s) novo(s), ${nMot} motivo(s) alterado(s)`);
  return { ev, motivos, nEv, nMot };
}

module.exports = { consolidar, motivoDe, eventosDaBusca, eventosDaLista };

if (require.main === module) {
  const url = conexao();
  if (!url) { console.error('Sem conexão com o Neon (ROBO_DATABASE_URL).'); process.exitCode = 1; }
  else consolidar({ sql: neon(url), simular: process.argv.includes('--simular') }).catch((e) => {
    console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exitCode = 1;
  });
}
