// Espelho do Atlas e do Bernhoeft: mostra, no formato dos portais, o que os robôs leram na VPS.
// Só lê: copia os out/pendencias.json dos containers pelo tailscale ssh e consulta o painel (GET).
// uso: node servidor.js   → abre http://127.0.0.1:3050
// As leituras do Atlas ficam guardadas em %LOCALAPPDATA%\gesdoc-espelho\atlas (fora do OneDrive: têm nome e CPF),
// para dar para comparar uma leitura com a anterior (o robô Atlas só guarda a última).
// Na VPS (services/espelho/compose.hml.yml) roda com DADOS=/dados e lê os out/ dos robôs direto do disco, sem ssh;
// SEM_CPF=1 mascara o CPF já no servidor (quem tem Tailscale vê a tela, o CPF inteiro não sai da VPS).
const http = require('http'), fs = require('fs'), path = require('path');
const { execFile } = require('child_process');

const PORTA = Number(process.env.PORTA || 3050);
const ESCUTAR = process.env.ESCUTAR || '127.0.0.1';
const VPS = 'augusto@100.103.196.93';
const PAINEL = process.env.PAINEL || 'http://100.103.196.93:3020';
const TAILSCALE = 'C:\\Program Files\\Tailscale\\tailscale.exe';
const GIT_SSH = 'C:\\Program Files\\Git\\usr\\bin';
const C_ATLAS = 'gesdoc-pendencias-hml-atlas-1';
const C_BERN = 'gesdoc-pendencias-hml-bernhoeft-1';
const DADOS = process.env.DADOS || '';
const PASTA = { [C_ATLAS]: 'pendencias-atlas', [C_BERN]: 'pendencias-bernhoeft' };
const SEM_CPF = process.env.SEM_CPF === '1';
const PAGINA_PAINEL = process.env.PAGINA_PAINEL || path.join(__dirname, '..', '..', 'bernhoeft-robo', 'deploy', 'gesdoc', 'services', 'painel', 'pagina.html');
const GUARDA = process.env.GUARDA || path.join(process.env.LOCALAPPDATA || '.', 'gesdoc-espelho', 'atlas');
// Planilhas "USO INTENSIVO ASSISTIDO" (services/planilha-envios grava 1 xlsx + 1 json por dia).
const PLANILHAS = process.env.PLANILHAS || (DADOS ? path.join(DADOS, 'planilhas-envios') : '');
const ARQ_PLANILHA = /^uso-intensivo-assistido-(\d{4}-\d\d-\d\d)\.(xlsx|json)$/;
fs.mkdirSync(GUARDA, { recursive: true });

// Arquivo do out/ de um robô: do disco (VPS) ou pelo tailscale ssh (PC).
const lerOut = (c, rel) => (DADOS ? Promise.resolve(fs.readFileSync(path.join(DADOS, PASTA[c], rel), 'utf8')) : remoto(`docker exec ${c} cat /app/out/${rel}`));
const listarOut = (c, rel) => (DADOS ? Promise.resolve(fs.readdirSync(path.join(DADOS, PASTA[c], rel)).join('\n')) : remoto(`docker exec ${c} ls /app/out/${rel}`));

// Troca todo campo "cpf" por ***.456.789-** (o meio continua servindo para contar pessoas diferentes).
function semCpf(o) {
  if (!SEM_CPF || !o || typeof o !== 'object') return o;
  for (const k of Object.keys(o)) {
    // Só mexe no CPF inteiro (11 dígitos): o que já está mascarado fica como está.
    if (k === 'cpf' && o[k]) { const d = String(o[k]).replace(/\D/g, ''); if (d.length === 11) o[k] = `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`; }
    else if (typeof o[k] === 'object') semCpf(o[k]);
  }
  return o;
}

function remoto(cmd) {
  return new Promise((ok, erro) => {
    execFile(TAILSCALE, ['ssh', VPS, cmd], {
      maxBuffer: 64 * 1024 * 1024, timeout: 60000, windowsHide: true,
      env: { ...process.env, PATH: `${GIT_SSH};${process.env.PATH}` },
    }, (e, out, err) => (e ? erro(new Error((err || e.message).trim().slice(0, 400))) : ok(out)));
  });
}

async function painel(rota) {
  try { const r = await fetch(PAINEL + rota); return r.ok ? r.json() : null; } catch { return null; }
}

const cache = {};
async function guardado(nome, novo, fn) {
  const c = cache[nome];
  if (!novo && c && Date.now() - c.em < 60000) return c.valor;
  const valor = await fn();
  cache[nome] = { em: Date.now(), valor };
  return valor;
}

const nomeLeitura = (iso) => String(iso).replace(/[:.]/g, '-') + '.json';
const leiturasAtlas = () => fs.readdirSync(GUARDA).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort().reverse();

async function atlas(novo) {
  return guardado('atlas', novo, async () => {
    const coleta = semCpf(JSON.parse(await lerOut(C_ATLAS, 'pendencias.json')));
    const arq = path.join(GUARDA, nomeLeitura(coleta.coletado_em));
    if (!fs.existsSync(arq)) fs.writeFileSync(arq, JSON.stringify(coleta));
    // O que o nosso sistema sabe de cada pendência (pelo document_schedule_id).
    const env = await painel('/api/envio');
    const nosso = {};
    for (const i of env?.itens || []) {
      if (!i.schedule_id) continue;
      nosso[i.schedule_id] = { id: i.id, estado: i.estado, pronta: i.pronta, motivos: i.motivos || [], resultado: i.resultado ? { ok: i.resultado.ok, msg: i.resultado.msg, em: i.resultado.em } : null };
    }
    for (const e of env?.enviados || []) {
      if (!e.schedule_id) continue;
      nosso[e.schedule_id] = { ...(nosso[e.schedule_id] || { id: e.id }), enviado_em: e.em, enviado_auto: e.auto };
    }
    // Linhas do banco (Neon) como o painel mostra: estado, de onde vem, por que está na fila, busca na Factorial.
    const pend = await painel('/api/pendencias');
    const banco = (pend?.linhas || []).filter((l) => l.origem === 'Atlas').map((l) => ({
      id: l.id, doc_id: l.doc_id, documento: l.documento, competencia: l.competencia, unidade: l.unidade, pedido: l.numero_pedido,
      prazo: String(l.prazo_envio || '').slice(0, 10), funcionario: l.funcionario, estado: l.estado, situacao: l.situacao, fonte: l.fonte,
      fila_motivo: l.fila_motivo || null, busca_factorial: l.busca_factorial || null, atualizado_em: l.atualizado_em, pdf_erro: l.pdf_erro || null,
      montagem: l.montagem ? { tipo: l.montagem.tipo, n: (l.montagem.itens || []).length } : null,
    }));
    return semCpf({ coleta, nosso, banco, modo: env?.modo || null, enviados: env?.enviados || [], painel_ok: !!env, leituras: leiturasAtlas(), cpf_oculto: SEM_CPF });
  });
}

async function bern(novo) {
  return guardado('bern', novo, async () => {
    const coleta = semCpf(JSON.parse(await lerOut(C_BERN, 'pendencias.json')));
    const hist = (await listarOut(C_BERN, 'historico')).split(/\s+/).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort().reverse();
    // O que a esteira achou para cada "Não Entregue" e o que o entregar.js enviou/conferiu.
    const [pend, env] = await Promise.all([painel('/api/pendencias'), painel('/api/envio-bern')]);
    const esteira = (pend?.linhas || []).filter((l) => l.origem === 'Bernhoeft').map((l) => ({
      chave: l.chave, contrato: l.contrato, descricao: l.descricao, area: l.area, estado: l.estado, confianca: l.confianca, motivo: l.motivo,
      tipo_reconhecido: l.tipo_reconhecido, arquivos: (l.arquivos || []).map((a) => a.filename), deixados: (l.deixados || []).length, erro: l.erro, buscado_em: l.buscado_em,
    }));
    return semCpf({ coleta, leituras: hist, esteira, envio: env ? { modo: env.modo, enviados: env.enviados || [], resultados: env.resultados || {}, segurar: env.segurar || {} } : null, painel_ok: !!pend, cpf_oculto: SEM_CPF });
  });
}

// ---------- histórico de ações dos robôs ----------
// Junta, em frases simples, o que os robôs fizeram: leituras (e o que mudou entre uma e outra), envios, recusas do site,
// pendências seguradas e as rodadas da sincronização da Factorial. Só lê arquivos que os robôs já gravam:
//   Atlas: atlas.db (todas as coletas), envios.log, envio/segurar.json, envio/historico-envios.json, envio/robo.json
//   Bernhoeft: historico/*.json (uma leitura por arquivo), envios.log
//   Sincronização: sincronizacao.log (blocos "== data" … JSON … "== fim HH:MM:SS (saída N)", hora de Brasília)
// No PC (sem DADOS) pede pronto ao espelho da VPS.
const VPS_ESPELHO = process.env.VPS_ESPELHO || 'http://100.103.196.93:3050';
const lerDados = (rel) => { try { return fs.readFileSync(path.join(DADOS, rel), 'utf8'); } catch { return ''; } };
const lerDadosJson = (rel) => { try { return JSON.parse(lerDados(rel)); } catch { return null; } };
const resumoBernArq = new Map(); // leitura do Bernhoeft já resumida (os arquivos não mudam)
const COMPETENCIA = (c) => String(c || '').replace(/^(\d{4})-(\d\d).*/, '$2/$1');
const msgSite = (s) => { const m = /"message":"([^"]+)"/.exec(s || ''); return m ? m[1] : String(s || '').replace(/^Atlas recusou o envio: /, '').slice(0, 160); };

function eventosAtlas(desde) {
  const ev = [];
  const { DatabaseSync } = require('node:sqlite');
  let db;
  try { db = new DatabaseSync(path.join(DADOS, 'pendencias-atlas', 'atlas.db'), { readOnly: true }); } catch (e) {
    return [{ em: new Date().toISOString(), robo: 'Atlas', tipo: 'erro', titulo: 'Não deu para ler o banco do robô Atlas', detalhe: e.message }];
  }
  try {
    // Leituras: cada coleta comparada com a anterior, pela pendência (document_schedule_id).
    const coletas = db.prepare('SELECT * FROM coletas WHERE coletado_em >= ? ORDER BY id').all(desde);
    const anterior = coletas.length ? db.prepare('SELECT * FROM coletas WHERE id < ? ORDER BY id DESC LIMIT 1').get(coletas[0].id) : null;
    const linhas = db.prepare('SELECT document_schedule_id s, aba, status, documento, unidades, competencia FROM pendencias WHERE coleta_id = ?');
    const mapa = (id) => { const m = new Map(); for (const l of linhas.all(id)) if (!m.has(l.s) || l.aba !== 'Reprovados') m.set(l.s, l); return m; };
    const nomeLinha = (l) => `${l.documento} · ${l.unidades || ''} · ${COMPETENCIA(l.competencia)}`;
    let antes = anterior ? mapa(anterior.id) : null;
    for (const c of coletas) {
      const agora = mapa(c.id);
      const itens = [];
      if (antes) {
        for (const [s, l] of agora) {
          const a = antes.get(s);
          if (!a) itens.push(`${/Rejected/.test(l.status) ? 'voltou recusado' : 'apareceu'}: ${nomeLinha(l)}`);
          else if (a.status !== l.status) itens.push(`mudou (${STATUS_SIMPLES[a.status] || a.status} → ${STATUS_SIMPLES[l.status] || l.status}): ${nomeLinha(l)}`);
        }
        for (const [s, l] of antes) if (!agora.has(s)) itens.push(`saiu da lista: ${nomeLinha(l)}`);
      }
      ev.push({ em: c.coletado_em, robo: 'Atlas', tipo: itens.length ? 'mudanca' : 'leitura',
        titulo: itens.length ? `Olhou o Atlas e achou ${itens.length} mudança(s)` : 'Olhou o Atlas: nada mudou',
        detalhe: `${c.atrasados} atrasados · ${c.proximas} no prazo · ${c.reprovados} recusados`, itens });
      antes = agora;
    }
    // Envios e tentativas (envios.log). A linha "#N schedule …" diz o nome do documento antes do envio.
    const quem = new Map();
    const hist = lerDadosJson('pendencias-atlas/envio/historico-envios.json');
    for (const e of (Array.isArray(hist) ? hist : Object.values(hist || {}))) if (e && e.id != null) quem.set(String(e.id), e.auto);
    const doSid = db.prepare('SELECT documento, unidades, competencia FROM pendencias WHERE document_schedule_id = ? ORDER BY id DESC LIMIT 1');
    const nome = {};
    for (const linha of lerDados('pendencias-atlas/envios.log').split('\n')) {
      const m = /^\[([^\]]+)\] (.*)$/.exec(linha);
      if (!m || m[1] < desde) { const c = m && /^#(\d+) schedule (\S+): Atlas/.exec(m[2]); if (c) { const l = doSid.get(c[2]); if (l) nome[c[1]] = nomeLinha(l); } continue; }
      const [, em, t] = m;
      let x;
      if ((x = /^#(\d+) schedule (\S+): Atlas "([^"]*)"/.exec(t))) { const l = doSid.get(x[2]); nome[x[1]] = l ? nomeLinha(l) : x[3]; }
      else if ((x = /^#(\d+) ENVIADO ao schedule \S+; status no Atlas agora: (\S+)/.exec(t))) {
        const auto = quem.get(x[1]);
        ev.push({ em, robo: 'Atlas', tipo: 'envio', grupo: 'envio', auto, titulo: 'Enviou documento ao Atlas', item: `${nome[x[1]] || '#' + x[1]} (ficou: ${STATUS_SIMPLES[x[2]] || x[2]})` });
      } else if ((x = /^Envio automático PULOU #(\d+) e seguiu: (.*)/.exec(t))) {
        ev.push({ em, robo: 'Atlas', tipo: 'recusa', grupo: 'recusa:' + msgSite(x[2]), titulo: `Tentou enviar e o site recusou: "${msgSite(x[2])}"`, item: nome[x[1]] || '#' + x[1] });
      } else if ((x = /^Envio automático PAROU em #(\d+): (.*)/.exec(t))) {
        ev.push({ em, robo: 'Atlas', tipo: 'parou', titulo: 'Parou a rodada de envio por causa de um erro', detalhe: `${nome[x[1]] || '#' + x[1]}: ${msgSite(x[2])}` });
      }
    }
    // Pendências seguradas (o automático não tenta mais).
    const seg = lerDadosJson('pendencias-atlas/envio/segurar.json') || {};
    for (const [id, s] of Object.entries(seg)) if (s?.em && s.em >= desde) {
      ev.push({ em: s.em, robo: 'Atlas', tipo: 'segurou', grupo: 'segurou', titulo: 'Segurou documento (o robô não tenta mais enviar sozinho)', item: `${nome[id] || '#' + id}: ${s.motivo || ''}` });
    }
  } finally { db.close(); }
  return ev;
}

function eventosBern(desde) {
  const ev = [];
  const pasta = path.join(DADOS, 'pendencias-bernhoeft', 'historico');
  let arqs = [];
  try { arqs = fs.readdirSync(pasta).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort(); } catch {}
  const quando = (f) => f.replace('.json', '').replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/, 'T$1:$2:$3.$4Z');
  const resumo = (f) => {
    if (!resumoBernArq.has(f)) {
      let itens = [];
      try { itens = JSON.parse(fs.readFileSync(path.join(pasta, f), 'utf8')).itens || []; } catch {}
      resumoBernArq.set(f, new Map(itens.map((x) => [x.chave, { status: x.status, nome: `${x.descricao} · ${x.contrato}` }])));
    }
    return resumoBernArq.get(f);
  };
  const i0 = arqs.findIndex((f) => quando(f) >= desde);
  if (i0 >= 0) {
    let antes = i0 > 0 ? resumo(arqs[i0 - 1]) : null;
    for (const f of arqs.slice(i0)) {
      const agora = resumo(f), itens = [];
      if (antes) {
        for (const [k, x] of agora) { const a = antes.get(k); if (!a) itens.push(`apareceu: ${x.nome} (${x.status})`); else if (a.status !== x.status) itens.push(`mudou (${a.status} → ${x.status}): ${x.nome}`); }
        for (const [k, x] of antes) if (!agora.has(k)) itens.push(`saiu da lista: ${x.nome}`);
      }
      const n = (s) => [...agora.values()].filter((x) => x.status === s).length;
      ev.push({ em: quando(f), robo: 'Bernhoeft', tipo: itens.length ? 'mudanca' : 'leitura',
        titulo: itens.length ? `Olhou o Bernhoeft e achou ${itens.length} mudança(s)` : 'Olhou o Bernhoeft: nada mudou',
        detalhe: `${agora.size} documentos · ${n('Não Entregue')} faltando entregar`, itens });
      antes = agora;
    }
  }
  for (const linha of lerDados('pendencias-bernhoeft/envios.log').split('\n')) {
    const m = /^\[([^\]]+)\] (.*)$/.exec(linha);
    if (!m || m[1] < desde) continue;
    const [, em, t] = m;
    if (/^ENVIADO/.test(t)) ev.push({ em, robo: 'Bernhoeft', tipo: 'envio', grupo: 'envio', auto: /automático/i.test(t), titulo: 'Enviou documento ao Bernhoeft', item: t.replace(/^ENVIADO( \(automático\))? /, '').replace(/"/g, '') });
    else if (/PAROU/.test(t)) ev.push({ em, robo: 'Bernhoeft', tipo: 'parou', titulo: 'Parou a rodada de envio automático', detalhe: t.replace(/^.*?PAROU:? ?/, '') });
    else if (/PULOU|FALHOU|ERRO/i.test(t)) ev.push({ em, robo: 'Bernhoeft', tipo: 'recusa', grupo: 'recusa', titulo: 'Tentou enviar e não conseguiu', item: t.replace(/^AUTOMÁTICO PULOU /, '') });
  }
  return ev;
}

function eventosSinc(desde) {
  const ev = [];
  const blocos = lerDados('sincronizacao/sincronizacao.log').split(/^== (?=\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$)/m).slice(1);
  for (const b of blocos) {
    const em = new Date(b.slice(0, 19).replace(' ', 'T') + '-03:00').toISOString();
    if (em < desde) continue;
    const fim = /== fim \S+ \(saída (\d+)\)/.exec(b);
    if (!fim) { ev.push({ em, robo: 'Sincronização', tipo: 'leitura', titulo: 'Sincronização da Factorial rodando (ainda não terminou)' }); continue; }
    if (fim[1] !== '0') {
      const erro = (b.split('\n').find((l) => /error|erro|denied|traceback/i.test(l)) || '').trim();
      // Erro conhecido em palavras simples; o texto original fica entre parênteses, para quem dá suporte.
      const simples = /pull access denied|No such image/i.test(erro) ? 'O programa da sincronização sumiu da VPS (a imagem do Docker foi apagada) e precisa ser refeito.' : '';
      ev.push({ em, robo: 'Sincronização', tipo: 'erro', titulo: 'Sincronização da Factorial falhou: não juntou nem gravou nada', detalhe: simples ? `${simples} (${erro.slice(0, 100)})` : erro.slice(0, 200) });
      continue;
    }
    let j = null;
    const a = b.indexOf('{'), z = b.lastIndexOf('}');
    try { j = JSON.parse(b.slice(a, z + 1)); } catch {}
    if (!j) { ev.push({ em, robo: 'Sincronização', tipo: 'leitura', titulo: 'Sincronização da Factorial rodou' }); continue; }
    const montados = Object.entries(j.por_doc_estado || {}).filter(([k]) => /COMPOSTO/.test(k)).reduce((s, [, v]) => s + v, 0);
    const motivos = Object.entries(j.motivos || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${v}× ${k}`);
    ev.push({ em, robo: 'Sincronização', tipo: montados ? 'envio' : 'leitura',
      titulo: montados ? `Sincronização da Factorial juntou ${montados} documento(s) num PDF` : 'Sincronização da Factorial rodou: nada novo para juntar',
      detalhe: `${j.pendencias ?? '?'} pendências de férias, rescisão e GFD conferidas${j.alertas_novos ? ` · ${j.alertas_novos} alerta(s) novo(s)` : ''}`, itens: motivos });
  }
  return ev;
}

// Envios ou recusas em sequência (mesma rodada, até 10 min de distância) viram uma linha só, com a lista.
function juntarRodadas(ev) {
  const out = [];
  for (const e of ev) {
    const u = out[out.length - 1];
    if (e.grupo && u && u.grupo === e.grupo && u.robo === e.robo && u.auto === e.auto && Date.parse(e.em) - Date.parse(u.fim || u.em) < 600000) {
      u.itens.push(e.item); u.fim = e.em; continue;
    }
    out.push(e.grupo ? { ...e, itens: [e.item] } : e);
  }
  for (const e of out) if (e.grupo && e.itens.length > 1) {
    e.titulo = e.tipo === 'envio' ? `${e.titulo.replace('Enviou documento', `Enviou ${e.itens.length} documentos`)}`
      : e.tipo === 'segurou' ? `Segurou ${e.itens.length} documentos (o robô não tenta mais enviar sozinho)`
        : e.titulo.replace('Tentou enviar', `Tentou enviar ${e.itens.length} documentos`);
  }
  return out;
}

const STATUS_SIMPLES = {
  CriticalDelay: 'atrasado crítico', Delay: 'atrasado', DelayNotSent: 'atrasado', DelayRejected: 'recusado', Pending: 'no prazo', PendingNotSent: 'no prazo',
  PendingRejected: 'recusado', WaitingForPredecessors: 'esperando outro documento', ToValidate: 'em análise', Valid: 'aprovado', Expired: 'vencido',
};

async function historico(dias) {
  if (!DADOS) {
    const r = await fetch(`${VPS_ESPELHO}/api/historico?dias=${dias}`);
    if (!r.ok) throw new Error('o espelho da VPS não respondeu (' + r.status + ')');
    return r.json();
  }
  return guardado('hist' + dias, false, async () => {
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    const ev = juntarRodadas([...eventosAtlas(desde), ...eventosBern(desde), ...eventosSinc(desde)].sort((a, b) => a.em.localeCompare(b.em))).reverse();
    for (const e of ev) { delete e.grupo; delete e.item; delete e.fim; }
    const robo = lerDadosJson('pendencias-atlas/envio/robo.json');
    const modoBern = lerDadosJson('pendencias-bernhoeft/envio/modo.json') || {};
    const ultBern = ev.find((e) => e.robo === 'Bernhoeft' && /^Olhou/.test(e.titulo));
    const ultSinc = ev.find((e) => e.robo === 'Sincronização');
    return {
      dias, gerado_em: new Date().toISOString(), eventos: ev,
      agora: {
        atlas: robo ? { fazendo: robo.fazendo, ultima: robo.ultima_rodada?.fim || robo.ultima_rodada?.inicio, proxima: robo.proxima, liberado: robo.liberado, automatico: robo.automatico,
          erro: Object.entries(robo.ultima_rodada?.codigos || {}).filter(([, c]) => c).map(([k]) => k) } : null,
        bern: { ultima: ultBern?.em || null, liberado: modoBern.liberado === true, automatico: modoBern.automatico === true, confianca: modoBern.confianca || 'alta' },
        sinc: ultSinc ? { em: ultSinc.em, ok: ultSinc.tipo !== 'erro' } : null,
      },
    };
  });
}

const enviar = (res, cod, obj) => { res.writeHead(cod, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method !== 'GET') return enviar(res, 405, { erro: 'só leitura' });
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'pagina.html')));
    }
    if (u.pathname === '/diag.js') {
      // As fichas analisadas à mão (DIAG) vêm da própria pagina.html do painel: fonte única.
      const pg = fs.readFileSync(PAGINA_PAINEL, 'utf8');
      const ini = pg.indexOf('const GRUPOS_DIAG'), fim = pg.indexOf('const soDigitos');
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(ini > 0 && fim > ini ? pg.slice(ini, fim) : 'const GRUPOS_DIAG = {}; const DIAG = [];');
    }
    if (u.pathname.startsWith('/fontes/')) {
      const f = path.join(__dirname, 'fontes', path.basename(u.pathname));
      if (!fs.existsSync(f)) return enviar(res, 404, { erro: 'não encontrado' });
      res.writeHead(200, { 'content-type': 'font/woff2' });
      return res.end(fs.readFileSync(f));
    }
    if (u.pathname === '/planilhas') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(__dirname, 'planilhas.html')));
    }
    if (u.pathname === '/api/planilhas') {
      if (!PLANILHAS) return enviar(res, 200, { dias: [], aviso: 'pasta das planilhas não configurada (PLANILHAS)' });
      let nomes = [];
      try { nomes = fs.readdirSync(PLANILHAS); } catch {}
      const dias = nomes.map((n) => n.match(ARQ_PLANILHA)).filter((m) => m && m[2] === 'xlsx').map((m) => m[1]).sort().reverse();
      return enviar(res, 200, { dias: dias.map((dia) => {
        let resumo = null;
        try { resumo = JSON.parse(fs.readFileSync(path.join(PLANILHAS, `uso-intensivo-assistido-${dia}.json`), 'utf8')).resumo; } catch {}
        return { dia, xlsx: `/planilhas/uso-intensivo-assistido-${dia}.xlsx`, resumo };
      }) });
    }
    if (u.pathname.startsWith('/api/planilhas/') || u.pathname.startsWith('/planilhas/')) {
      // Só arquivos com o nome exato do gerador (sem caminho): /api/planilhas/<dia> = json; /planilhas/<arquivo>.xlsx = download.
      const api = u.pathname.startsWith('/api/');
      const nome = api ? `uso-intensivo-assistido-${path.basename(u.pathname)}.json` : path.basename(u.pathname);
      if (!PLANILHAS || !ARQ_PLANILHA.test(nome)) return enviar(res, 404, { erro: 'planilha não encontrada' });
      let buf;
      try { buf = fs.readFileSync(path.join(PLANILHAS, nome)); } catch { return enviar(res, 404, { erro: 'planilha não encontrada' }); }
      if (api) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); return res.end(buf); }
      res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${nome}"`,
      });
      return res.end(buf);
    }
    const novo = u.searchParams.has('novo');
    if (u.pathname === '/api/atlas') return enviar(res, 200, await atlas(novo));
    if (u.pathname === '/api/bern') return enviar(res, 200, await bern(novo));
    if (u.pathname === '/api/historico') return enviar(res, 200, await historico(Math.min(30, Math.max(1, Number(u.searchParams.get('dias')) || 3))));
    if (u.pathname === '/api/atlas/leitura') {
      const arq = path.basename(u.searchParams.get('arq') || '');
      if (!leiturasAtlas().includes(arq)) return enviar(res, 404, { erro: 'leitura não guardada' });
      return enviar(res, 200, semCpf(JSON.parse(fs.readFileSync(path.join(GUARDA, arq), 'utf8'))));
    }
    if (u.pathname === '/api/bern/leitura') {
      const arq = u.searchParams.get('arq') || '';
      if (!/^\d{4}-\d\d-\d\dT[\d-]+Z\.json$/.test(arq)) return enviar(res, 400, { erro: 'nome inválido' });
      return enviar(res, 200, semCpf(JSON.parse(await lerOut(C_BERN, `historico/${arq}`))));
    }
    enviar(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    enviar(res, 502, { erro: e.message });
  }
}).listen(PORTA, ESCUTAR, () => console.log(`Espelho no ar: http://${ESCUTAR}:${PORTA}  (Ctrl+C para fechar)`));
