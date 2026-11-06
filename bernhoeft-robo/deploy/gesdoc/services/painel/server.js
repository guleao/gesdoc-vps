// Painel da automação de documentos (homologação): mostra o que os robôs estão fazendo, de ponta a ponta.
// Só leitura nos portais e na Factorial. Escreve apenas: o código de 2FA do Atlas (8 letras/números) em codigo.txt,
// que o robô lê e apaga, o sinal "rodar-agora" dos robôs (botão Reiniciar) e os pacotes Bernhoeft em PACOTES
// (manuais: pacote.js; automáticos, a cada leitura nova do Bernhoeft: auto.js), e, na aba Envio, o botão do envio automático
// e os pedidos verificar/enviar em /codigo/envio, que o robo.js do Atlas executa (o painel em si não fala com o Atlas).
// Fontes: Docker (estado e logs, via docker-socket-proxy só leitura), arquivos de saída dos robôs (/dados),
//         Neon (contagem por estado na tabela documentos, via HTTPS), Gotenberg e n8n (health).
// Sem dependências: node server.js. Acesso só pela rede do Tailscale (ESCUTAR = IP do Tailscale).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ESCUTAR = process.env.ESCUTAR || '127.0.0.1';
const PORTA = Number(process.env.PORTA || 3020);
const DOCKER = process.env.DOCKER_URL || 'http://127.0.0.1:3021';
const DADOS = process.env.DADOS || '/dados';
const ARQ_CODIGO = process.env.ARQ_CODIGO || '/codigo/codigo.txt';
const CODIGO_MIN = Number(process.env.CODIGO_MIN || 30);
const GOTENBERG = process.env.GOTENBERG_URL || 'http://127.0.0.1:3010';
const N8N = process.env.N8N_URL || 'http://127.0.0.1:5678';
// Role só leitura (painel_leitura, seguranca/roles.sql); sem ela, usa a do robô.
const NEON = process.env.PAINEL_DATABASE_URL || process.env.ROBO_DATABASE_URL;
const ATLAS = process.env.CONTAINER_ATLAS || 'gesdoc-pendencias-hml-atlas-1';
const BERNHOEFT = process.env.CONTAINER_BERNHOEFT || 'gesdoc-pendencias-hml-bernhoeft-1';
const PDF = process.env.CONTAINER_PDF || 'gesdoc-pdf-hml-pdf-1';
const PREFIXOS = ['gesdoc-', 'n8n-'];
const PAGINA = path.join(__dirname, 'pagina.html');
const pacote = require('./pacote');
const auto = require('./auto');
// Botão "Reiniciar": o robô confere este arquivo enquanto dorme e lê na hora (e apaga o arquivo).
const SINAL_BERNHOEFT = process.env.SINAL_BERNHOEFT || '/sinal-bernhoeft/rodar-agora';
const SINAL_ATLAS = process.env.SINAL_ATLAS || path.join(path.dirname(ARQ_CODIGO), 'rodar-agora');

const ler = (arq) => { try { return fs.readFileSync(arq, 'utf8'); } catch { return null; } };
const lerJson = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };
// Nada de URL de banco nem CPF no painel.
// (CPF também colado em nome de arquivo, ex.: doc9_12345678901_07-2026.pdf, onde \b não pega.)
// Nome do container para a tela: "gesdoc-pendencias-hml-atlas-1" vira "Robô Atlas" (o nome técnico fica só no title).
const APELIDOS = [[/pendencias-\w+-atlas/, 'Robô Atlas'], [/pendencias-\w+-bernhoeft/, 'Robô Bernhoeft'], [/-pdf-/, 'Serviço de PDF'],
  [/navegacao/, 'Navegador (Playwright)'], [/painel-\w+-docker/, 'Leitor do Docker (painel)'], [/painel/, 'Painel'], [/n8n-worker/, 'n8n (worker)'], [/^n8n/, 'n8n'],
  [/(hml|prd)-postgres/, (m) => `Postgres (${m.includes('prd') ? 'produção' : 'homologação'})`], [/(hml|prd)-redis/, (m) => `Redis (${m.includes('prd') ? 'produção' : 'homologação'})`]];
const apelido = (nome) => {
  const [, r] = APELIDOS.find(([re]) => re.test(nome)) || [, nome.replace(/^gesdoc-/, '').replace(/-\d+$/, '')];
  return typeof r === 'function' ? r(nome) : r;
};
const limpar = (s) => String(s)
  .replace(/\bgesdoc-[a-z0-9-]+/g, apelido)
  .replace(/postgres(ql)?:\/\/\S+/g, '<url>')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***')
  .replace(/(?<!\d)\d{11}(?!\d)/g, '***');

// Gotenberg loga JSON: vira "POST /forms/pdfengines/merge → 200 · 1.2s · 980 KB". Health check some (é a cada 30 s).
function linhaPdf(t) {
  // O Chromium do Gotenberg tenta falar com o Google e a deny-list bloqueia (esperado): só ruído.
  if (/(CONNECT|forward) blocked for '/.test(t)) return null;
  // Desenho ASCII do nome na partida (linhas sem 3 letras seguidas) e o subtítulo dele.
  if (!t.startsWith('{') && (!/[A-Za-z]{3}/.test(t) || /^A Docker-based API/.test(t))) return null;
  if (!t.startsWith('{')) return t;
  try {
    const j = JSON.parse(t);
    if (/\/health/.test(j.path || j.uri || '')) return null;
    if (j.path || j.uri) {
      const kb = j.bytes_out ? ` · ${Math.round(j.bytes_out / 1024)} KB` : '';
      return `${j.method || ''} ${j.path || j.uri} → ${j.status ?? '?'}${j.latency_human ? ' · ' + j.latency_human : ''}${kb}${j.level === 'error' ? ' · ERRO ' + (j.error || j.msg || '') : ''}`.trim();
    }
    return `${j.level === 'error' ? 'ERRO: ' : ''}${j.msg || t}${j.error ? ' · ' + j.error : ''}`;
  } catch { return t; }
}
const UNIAO = /\/forms\/pdfengines\/merge/;

async function comTempo(url, opts = {}, ms = 5000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}

// ---------- Docker ----------
async function containers() {
  const r = await comTempo(`${DOCKER}/containers/json?all=1`);
  if (!r.ok) throw new Error(`Docker respondeu ${r.status}`);
  return (await r.json())
    .map((c) => ({ nome: c.Names[0].replace(/^\//, ''), estado: c.State, status: c.Status, imagem: c.Image }))
    .map((c) => ({ ...c, rotulo: apelido(c.nome) }))
    .filter((c) => PREFIXOS.some((p) => c.nome.startsWith(p)))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

// Log sem TTY vem multiplexado: blocos com cabeçalho de 8 bytes (tipo, 0, 0, 0, tamanho em 4 bytes).
function demux(buf) {
  if (!buf.length || buf[0] > 2) return buf.toString('utf8');
  let out = '';
  for (let i = 0; i + 8 <= buf.length;) {
    const n = buf.readUInt32BE(i + 4);
    out += buf.subarray(i + 8, i + 8 + n).toString('utf8');
    i += 8 + n;
  }
  return out;
}

// Linhas [{em: Date ISO, texto}] do log do container.
async function logs(nome, tail = 300) {
  const r = await comTempo(`${DOCKER}/containers/${encodeURIComponent(nome)}/logs?stdout=1&stderr=1&timestamps=1&tail=${tail}`);
  if (!r.ok) throw new Error(`log de ${nome}: ${r.status}`);
  return demux(Buffer.from(await r.arrayBuffer()))
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf(' ');
      const texto = nome === PDF ? linhaPdf(l.slice(i + 1)) : l.slice(i + 1);
      return texto === null ? null : { em: new Date(l.slice(0, i)).toISOString(), texto: limpar(texto) };
    })
    .filter((l) => l && !/ExperimentalWarning|trace-warnings/.test(l.texto));
}

// ---------- Atlas ----------
async function estadoAtlas() {
  const out = path.join(DADOS, 'pendencias-atlas');
  const r = { login: 'desconhecido' };
  let ls = [];
  // 3000 linhas: uma rodada com a busca do SharePoint passa de 500, e o "Login feito" fica no começo dela.
  try { ls = await logs(ATLAS, 3000); } catch (e) { r.erro_log = e.message; }
  // Último evento que diz algo sobre o login.
  for (let i = ls.length - 1; i >= 0; i--) {
    const t = ls[i].texto;
    if (/Grave-o em/.test(t)) {
      const ate = new Date(new Date(ls[i].em).getTime() + CODIGO_MIN * 60000);
      if (ate > new Date()) { r.login = 'aguardando_codigo'; r.codigo_ate = ate.toISOString(); }
      else { r.login = 'falha'; r.motivo = 'Código não informado a tempo.'; }
      break;
    }
    if (/^ERRO:/.test(t)) { r.login = 'falha'; r.motivo = t.replace(/^ERRO:\s*/, ''); r.falha_em = ls[i].em; break; }
    if (/Código informado/.test(t)) { r.login = 'verificando'; break; }
    if (/linha\(s\) gravadas|Login feito|Sessão ok|Token/.test(t)) { r.login = 'ok'; break; }
  }
  // Próxima tentativa: "[hh:mm:ss] saída N; próxima leitura em X min".
  for (let i = ls.length - 1; i >= 0; i--) {
    const m = ls[i].texto.match(/próxima leitura em (\d+) min/);
    if (m) { r.proxima = new Date(new Date(ls[i].em).getTime() + Number(m[1]) * 60000).toISOString(); break; }
  }
  r.codigo_gravado = fs.existsSync(ARQ_CODIGO);
  const p = lerJson(path.join(out, 'pendencias.json'));
  if (p) {
    r.coletado_em = p.coletado_em;
    r.totais = p.totais;
    const porDoc = {};
    for (const l of p.pendencias || []) {
      const k = l.nome || l.documento || l.categoria || '?';
      porDoc[k] = (porDoc[k] || 0) + 1;
    }
    r.por_documento = Object.entries(porDoc).sort((a, b) => b[1] - a[1]).slice(0, 30);
  }
  const ciclo = ler(path.join(out, 'ciclo.log'));
  if (ciclo) r.ciclo = ciclo.trim().split('\n').slice(-40).map(limpar);
  const sim = lerJson(path.join(out, 'enviar-simulacao.json'));
  if (sim) {
    const res = lerJson(path.join(out, 'envio', 'resultados.json')) || {};
    const hist = lerJson(path.join(out, 'envio', 'historico-envios.json'));
    const foi = new Set([...(Array.isArray(hist) ? hist : []).map((x) => String(x.id)),
      ...Object.entries(res).filter(([, x]) => x.acao === 'enviar' && x.ok).map(([id]) => id)]);
    const lista = (sim.itens || []).filter((i) => !foraDoAtlas(i) && !foi.has(String(i.id)));
    const seg = lerJson(path.join(out, 'envio', 'segurar.json')) || {};
    r.simulacao = { gerado_em: sim.gerado_em, itens: lista.length, prontas: lista.filter((i) => i.pronta && !seg[i.id]).length };
  }
  // Busca do robô na Factorial (67/68/69): as não achadas continuam PENDENTE_ENVIO no banco, mas já foram buscadas.
  const bf = lerJson(path.join(out, 'envio', 'busca.json'));
  if (bf) r.busca_factorial = { em: bf.em || null, buscadas: (bf.itens || []).length, nao: (bf.itens || []).filter((i) => !i.achou).length };
  // Interruptores da aba Envio: sem o arquivo = envio bloqueado e automático desligado.
  const modo = lerJson(path.join(out, 'envio', 'modo.json')) || {};
  r.envio_liberado = modo.liberado === true;
  r.envio_automatico = r.envio_liberado && modo.automatico === true;
  try { r.pdfs_unidos = fs.readdirSync(path.join(out, 'unidos'), { recursive: true }).filter((f) => /\.pdf$/i.test(f)).length; } catch { r.pdfs_unidos = 0; }
  return r;
}

// ---------- Bernhoeft ----------
const cacheHist = new Map(); // arquivo -> qtd pendente
function estadoBernhoeft() {
  const out = path.join(DADOS, 'pendencias-bernhoeft');
  const r = {};
  const p = lerJson(path.join(out, 'pendencias.json'));
  if (p) {
    r.coletado_em = p.coletado_em;
    r.total = p.total;
    r.por_status = p.relatorio012?.documentos_por_status || null;
    r.pendentes = (p.itens || []).filter((i) => i.docs_pendentes).map((i) => ({
      contrato: i.contrato, area: i.area, descricao: i.descricao, status: i.status, unidade: i.unidade, tipo: i.tipo,
      contratada: i.contratada, risco: i.risco, competencia: i.competencia, colaboradores: limpar(i.colaboradores || ''), chave: limpar(i.chave || ''),
    }));
    r.itens_status = (p.itens || []).reduce((s, i) => ({ ...s, [i.status || '?']: (s[i.status || '?'] || 0) + 1 }), {});
  }
  // Quantos pendentes em cada leitura (últimas 96 = 2 dias a cada 30 min) e quais (para "pendente desde").
  let arqs = [];
  try { arqs = fs.readdirSync(path.join(out, 'historico')).filter((f) => f.endsWith('.json')).sort().slice(-96); } catch {}
  const hist = arqs.map((f) => {
    if (!cacheHist.has(f)) {
      const h = lerJson(path.join(out, 'historico', f));
      const pend = h ? (h.itens || []).filter((i) => i.docs_pendentes) : [];
      cacheHist.set(f, h ? { em: h.coletado_em, pendentes: pend.length, chaves: pend.map((i) => limpar(i.chave || '')) } : null);
    }
    return cacheHist.get(f);
  }).filter(Boolean);
  r.historico = hist.map(({ em, pendentes }) => ({ em, pendentes }));
  // Primeira leitura (das guardadas) em que cada pendência aparece, e em quantas leituras ela está.
  for (const pe of r.pendentes || []) {
    const vistas = hist.filter((h) => h.chaves.includes(pe.chave));
    pe.pendente_desde = vistas[0]?.em || r.coletado_em || null;
    pe.leituras = vistas.length;
  }
  r.leituras_guardadas = hist.length;
  // Mudanças (NOVA / SAIU / ALTERADA) do fim do mudancas.txt.
  const txt = ler(path.join(out, 'mudancas.txt')) || '';
  const eventos = [];
  let em = null;
  for (const l of txt.slice(-300000).split('\n')) {
    const c = l.match(/^Coletado em (\S+):/);
    if (c) { em = c[1]; continue; }
    const m = l.match(/^\s+(NOVA|SAIU|ALTERADA)\s+(.*)$/);
    if (m) eventos.push({ em, tipo: m[1], texto: limpar(m[2]) });
  }
  r.mudancas = eventos.slice(-60).reverse();
  return r;
}

// Data e hora do Neon vêm sem fuso ("2026-10-15 15:50:42.5") e estão em UTC (now() do banco): vira ISO com Z para a página
// mostrar no horário de Brasília. Só data ("2026-07-03") fica como está.
const utc = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;

// ---------- Neon (HTTPS, sem driver) ----------
let cacheNeon = { em: 0, dados: null };
async function sql(query) {
  const host = new URL(NEON).hostname.replace(/^[^.]+\./, 'api.');
  const r = await comTempo(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Neon-Connection-String': NEON, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'false' },
    body: JSON.stringify({ query, params: [] }),
  }, 10000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(limpar(j.message || `Neon respondeu ${r.status}`));
  return j.rows;
}
async function estadoNeon() {
  if (!NEON) return { erro: 'ROBO_DATABASE_URL não configurada no painel.' };
  if (Date.now() - cacheNeon.em < 60000 && cacheNeon.dados) return cacheNeon.dados;
  try {
    // Contagem só do que ainda aparece no Atlas (e das enviadas); sem coleta para comparar, conta tudo.
    const docs = await documentosNeon();
    if (docs.erro) throw new Error(docs.erro);
    const conta = {};
    let fora = 0;
    for (const x of docs.linhas) {
      if (x.no_atlas === false && x.estado !== 'ENVIADO') { fora++; continue; }
      const e = x.estado || '(vazio)';
      conta[e] = (conta[e] || 0) + 1;
    }
    const estados = Object.entries(conta).map(([estado, n]) => ({ estado, n })).sort((a, b) => b.n - a.n);
    const recentes = await sql(`SELECT nome, competencia, unidade, estado, funcionario, atualizado_em, enviado_em
      FROM documentos WHERE atualizado_em IS NOT NULL ORDER BY atualizado_em DESC LIMIT 30`);
    // Com Neon-Raw-Text-Output os números chegam como texto.
    cacheNeon = { em: Date.now(), dados: { estados, fora_do_atlas: fora,
      recentes: recentes.map((x) => ({ ...x, funcionario: limpar(x.funcionario || ''), atualizado_em: utc(x.atualizado_em), enviado_em: utc(x.enviado_em) })) } };
  } catch (e) {
    cacheNeon = { em: Date.now(), dados: { erro: e.message } };
  }
  return cacheNeon.dados;
}

// PDF de uma pendência do Atlas aqui na VPS (mesma regra do acharArquivo do enviar.js), na pasta downloads do robô:
//   "factorial:<id Factorial>" (LOCALIZADO) -> downloads/factorial-docs/<id>.pdf
//   caminho de outra máquina ("downloads\factorial\120\doc9_...pdf", COMPOSTO) -> downloads/factorial/<id Neon>/*.pdf
//   "sharepoint:<id do item>" (LOCALIZADO pelo sharepoint.js --gravar) -> downloads/sharepoint/<id>.pdf
//   "/srv/gesdoc/downloads/<id Neon>/<nome>" (sincronização do Evilásio na VPS, services/sincronizacao) -> sincronizacao/downloads/<id>/<nome>
const ATLAS_DOWNLOADS = path.join(DADOS, 'pendencias-atlas', 'downloads');
const SINC_DOWNLOADS = path.join(DADOS, 'sincronizacao', 'downloads');
function pdfAtlas(l) {
  const pdfEm = (dir, filtro) => { try { const f = fs.readdirSync(dir).find((x) => /\.pdf$/i.test(x) && filtro(x)); return f ? path.join(dir, f) : null; } catch { return null; } };
  const sinc = /^\/srv\/gesdoc\/downloads\/(\d+)\/([^/]+)$/.exec(l.caminho_origem || '');
  if (sinc) return pdfEm(path.join(SINC_DOWNLOADS, sinc[1]), (x) => x === sinc[2]);
  const fid = /^factorial:(\d+)$/i.exec(l.caminho_origem || '');
  if (fid) return pdfEm(path.join(ATLAS_DOWNLOADS, 'factorial-docs'), (x) => x.startsWith(fid[1] + '.'));
  const sid = /^sharepoint:(.+)$/i.exec(l.caminho_origem || '');
  if (sid) return existe(pdfShp(`${sid[1]}.pdf`));
  if (!l.caminho_origem && l.estado !== 'COMPOSTO') return null;
  const nome = path.basename(String(l.caminho_origem || '').replace(/\\/g, '/'));
  return pdfEm(path.join(ATLAS_DOWNLOADS, 'factorial', String(l.id)), (x) => !nome || x === nome)
    || pdfEm(path.join(ATLAS_DOWNLOADS, 'factorial', String(l.id)), () => true);
}
const arquivosAtlas = new Map(); // id Neon -> caminho do PDF (o caminho tem CPF: nunca vai para a página)

// ---------- SharePoint (sharepoint.js --baixar, rodado pelo robô Atlas a cada rodada) ----------
// envio/busca-sharepoint.json: por pendência do Neon (PENDENTE_ENVIO de origem SharePoint), o que a busca achou.
// Os PDFs ficam em downloads/sharepoint/<id do item>.pdf. Só para conferir: nada disso foi gravado no banco.
const ARQ_SHP = path.join(DADOS, 'pendencias-atlas', 'envio', 'busca-sharepoint.json');
const SHP_DIR = path.join(ATLAS_DOWNLOADS, 'sharepoint');
const pdfShp = (local) => local && /^[A-Za-z0-9!_-]+\.pdf$/.test(local) ? path.join(SHP_DIR, local) : null;
const existe = (arq) => arq && fs.existsSync(arq) ? arq : null;
let cacheShp = { mtime: 0, dados: null };
function buscaSharepoint() {
  try {
    const m = fs.statSync(ARQ_SHP).mtimeMs;
    if (m !== cacheShp.mtime) cacheShp = { mtime: m, dados: lerJson(ARQ_SHP) };
  } catch { cacheShp = { mtime: 0, dados: null }; }
  return cacheShp.dados;
}
// envio/montagem-sharepoint.json: de que pasta e partes saiu o PDF de cada pendência (id do Neon). Fica mesmo depois que a
// pendência sai da busca (gravada no banco), para a aba Envio mostrar o que vai dentro antes de enviar.
const ARQ_MONTAGEM_SHP = path.join(DADOS, 'pendencias-atlas', 'envio', 'montagem-sharepoint.json');
let cacheMontShp = { mtime: 0, dados: {} };
function montagensSharepoint() {
  try {
    const m = fs.statSync(ARQ_MONTAGEM_SHP).mtimeMs;
    if (m !== cacheMontShp.mtime) cacheMontShp = { mtime: m, dados: lerJson(ARQ_MONTAGEM_SHP) || {} };
  } catch { cacheMontShp = { mtime: 0, dados: {} }; }
  return cacheMontShp.dados;
}
// O que a página recebe de cada pendência: pasta, arquivo, motivo e as partes (benefícios) com o endereço de cada PDF.
function resumoShp(i, em) {
  return {
    em: em || null, achou: !!i.achou, arquivo: i.arquivo ? limpar(i.arquivo) : null, pasta: i.pasta ? limpar(i.pasta) : null,
    modificado: i.modificado || null, motivo: limpar(i.motivo || ''), candidatos: (i.candidatos || []).map(limpar),
    unido: !!i.unido, aviso: i.aviso ? limpar(i.aviso) : null, deixados: (i.deixados || []).map((d) => ({ nome: limpar(d.nome), motivo: limpar(d.motivo) })),
    partes: (i.partes || []).map((p) => {
      const arq = existe(pdfShp(p.local)), t = arq && tamanho(arq);
      return { nome: limpar(p.nome), papel: p.papel ? limpar(p.papel) : null, modificado: p.modificado || null, pasta: i.pasta ? limpar(i.pasta) : null,
        url: t ? `sharepoint/${p.local}` : null, kb: t?.kb ?? null, paginas: t ? paginasPdf(arq) : null,
        erro: p.erro ? limpar(p.erro) : t ? t.erro : 'ainda não baixado' };
    }),
  };
}
// Números para a Visão geral (do último resultado da busca).
function estadoSharepoint() {
  const s = buscaSharepoint();
  if (!s) return null;
  const it = s.itens || [];
  const achadas = it.filter((i) => i.achou).length, partes = it.filter((i) => !i.achou && i.partes?.length).length;
  return { em: s.em || null, modo: s.modo || null, erro: s.erro ? limpar(s.erro) : null, erro_em: s.erro_em || null,
    buscadas: it.length, achadas, partes, nao: it.length - achadas - partes };
}

// ---------- Rastro de cada documento do Atlas: de que arquivos o PDF foi feito e para onde foi ----------
// Factorial: nome, pasta e data do arquivo gravado em caminho_origem ("factorial:<id>"), pela API (só leitura, ids[] em lotes).
// Fica em memória: o arquivo de um id não muda. Se a consulta não terminar a tempo, a página mostra "consultando" até a próxima.
const factorialDocs = new Map(); // id Factorial -> { arquivo, pasta, criado, assinatura } ou { erro }
let pastasFactorial = { em: 0, mapa: {} };
let erroFactorial = null;
async function infoFactorial(ids) {
  const faltam = [...new Set(ids)].filter((i) => !factorialDocs.has(i));
  if (!faltam.length || !pacote.temChave()) return;
  try {
    if (Date.now() - pastasFactorial.em > 6 * 3600000) {
      pastasFactorial = { em: Date.now(), mapa: Object.fromEntries((await pacote.todos('/documents/folders')).map((f) => [String(f.id), f.name])) };
    }
    for (let i = 0; i < faltam.length; i += 50) {
      const lote = faltam.slice(i, i + 50);
      const j = await pacote.api(`/documents/documents?${lote.map((x) => `ids[]=${x}`).join('&')}&limit=100`);
      for (const d of j.data || []) {
        factorialDocs.set(String(d.id), { arquivo: limpar(d.filename || ''), pasta: pastasFactorial.mapa[String(d.folder_id)] || null,
          criado: d.created_at || null, assinatura: d.signature_status || null, erro: d.deleted_at ? 'apagado na Factorial depois de baixado' : null });
      }
      for (const x of lote) if (!factorialDocs.has(x)) factorialDocs.set(x, { erro: 'não encontrado na Factorial (apagado ou sem acesso)' });
    }
    erroFactorial = null;
  } catch (e) { erroFactorial = limpar(e.message); }
}
let consultaFactorial = null;
async function infoFactorialRapida(ids) {
  consultaFactorial ||= infoFactorial(ids).finally(() => { consultaFactorial = null; });
  await Promise.race([consultaFactorial, new Promise((ok) => setTimeout(ok, 8000))]);
}

// Destinos, protocolos e histórico de etapas (sincronização do Evilásio). Precisam de SELECT para o usuário do painel
// (role painel_leitura); sem ele a página diz o que falta em vez de esconder.
let cacheRastro = { em: 0, dados: null };
async function rastroNeon() {
  if (Date.now() - cacheRastro.em < 60000 && cacheRastro.dados) return cacheRastro.dados;
  const erros = [];
  const tentar = (tabela, q) => sql(q).catch((e) => {
    erros.push(/permission denied|permissão negada/i.test(e.message) ? `o painel não tem permissão de ler ${tabela}` : `${tabela}: ${limpar(e.message)}`);
    return null;
  });
  const [regraDest, destinos, protocolos, envios] = await Promise.all([
    tentar('documento_regra_destinos', 'SELECT doc_id, destino FROM documento_regra_destinos'),
    tentar('documento_destinos', 'SELECT id, documento_id, destino, estado, situacao_portal, atualizado_em FROM documento_destinos'),
    tentar('documento_protocolos', `SELECT documento_id, destino_id, plataforma, protocolo, data_protocolo, estado_protocolo, resultado_texto
      FROM documento_protocolos ORDER BY data_protocolo NULLS LAST`),
    tentar('documento_envios', `SELECT documento_id, etapa, status, mensagem_erro, dados_resposta, coalesce(timestamp_fim, timestamp_inicio, criado_em) AS em
      FROM documento_envios ORDER BY criado_em DESC LIMIT 5000`),
  ]);
  const porDoc = (rows, k = 'documento_id') => {
    const m = new Map();
    for (const r of rows || []) { const c = String(r[k]); if (!m.has(c)) m.set(c, []); m.get(c).push(r); }
    return m;
  };
  cacheRastro = { em: Date.now(), dados: { erros, regraDest: regraDest && porDoc(regraDest, 'doc_id'), destinos: porDoc(destinos), protocolos: porDoc(protocolos), envios: envios && porDoc(envios) } };
  return cacheRastro.dados;
}

// Arquivos que a sincronização diz ter usado, achados no JSON de uma etapa (documento_envios.dados_resposta):
// qualquer lista em chave com cara de parte/arquivo/documento, com nome e id quando houver.
function partesDoJson(j, fundo = 0) {
  if (!j || typeof j !== 'object' || fundo > 3) return [];
  for (const [k, v] of Object.entries(j)) {
    if (Array.isArray(v) && /part|arquiv|file|document|fonte|origem|anexo|pdfs/i.test(k) && v.length) {
      return v.map((x) => typeof x === 'object' && x
        ? { arquivo: limpar(x.filename || x.nome || x.name || x.arquivo || x.caminho || x.path || ''), id: x.id ?? x.factorial_id ?? x.document_id ?? null,
          pasta: x.pasta || x.folder || null, criado: x.created_at || x.criado || null }
        : { arquivo: limpar(path.basename(String(x).replace(/\\/g, '/'))), id: null });
    }
  }
  for (const v of Object.values(j)) { const p = partesDoJson(v, fundo + 1); if (p.length) return p; }
  return [];
}
const jsonOuNada = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

// Montagem de um PDF do SharePoint (registro do sharepoint.js): arquivo único da pasta ou partes unidas na ordem, com o papel de cada uma.
function montagemShp(i, id) {
  if (!i) return null;
  const pasta = i.pasta ? limpar(i.pasta) : null;
  const parte = (p) => {
    const arq = existe(pdfShp(p.local)), t = arq && tamanho(arq);
    return { origem: 'SharePoint', id: p.sharepoint_id || null, arquivo: limpar(p.nome || ''), pasta, papel: p.papel ? limpar(p.papel) : null, criado: p.modificado || null,
      url: t ? `sharepoint/${p.local}` : null, kb: t?.kb ?? null, paginas: arq ? paginasPdf(arq) : null, erro: p.erro ? limpar(p.erro) : t ? t.erro : 'parte não está mais na VPS' };
  };
  const extra = { aviso: i.aviso ? limpar(i.aviso) : null, deixados: (i.deixados || []).map((d) => ({ nome: limpar(d.nome), motivo: limpar(d.motivo) })) };
  if (i.unido) return { tipo: 'unido', por: 'robô (SharePoint)', final: i.local || null, itens: (i.partes || []).map(parte), ...extra };
  return { tipo: 'único', itens: [parte({ nome: i.arquivo, sharepoint_id: i.sharepoint_id || id, modificado: i.modificado, local: i.local })], ...extra };
}

// De que arquivos o PDF da pendência foi feito.
function montagemDe(x, rastro, shp) {
  const c = String(x.caminho_origem || '');
  const etapas = (rastro.envios?.get(String(x.id)) || []);
  const partesSinc = etapas.map((e) => partesDoJson(jsonOuNada(e.dados_resposta))).find((p) => p.length) || [];
  const f = /^factorial:(\d+)$/i.exec(c);
  if (f) {
    const i = factorialDocs.get(f[1]);
    return { tipo: 'único', itens: [{ origem: 'Factorial', id: f[1], ...(i || { erro: pacote.temChave() ? (erroFactorial ? `não consultou a Factorial: ${erroFactorial}` : 'consultando a Factorial…') : 'painel sem a chave da Factorial' }) }] };
  }
  const s = /^sharepoint:(.+)$/i.exec(c);
  if (s) {
    const i = montagensSharepoint()[String(x.id)] || (shp?.itens || []).find((y) => y.local === `${s[1]}.pdf` || String(y.id) === String(x.id));
    return montagemShp(i, s[1]) || { tipo: 'único', itens: [{ origem: 'SharePoint', id: s[1], erro: 'a busca não guardou de que pasta veio este arquivo' }] };
  }
  if (partesSinc.length || ['COMPOSTO', 'ERRO_COMPOSICAO'].includes(x.estado) || (c && x.estado === 'ENVIADO')) {
    const semLer = !rastro.envios;
    return { tipo: 'unido', por: 'sincronização da Factorial (Evilásio)', final: c ? limpar(path.basename(c.replace(/\\/g, '/'))) : null, itens: partesSinc.map((p) => ({ origem: 'Factorial', ...p })),
      nota: partesSinc.length ? null : semLer ? 'o painel não tem permissão de ler o histórico da sincronização (documento_envios), onde ficaria a lista de partes'
        : 'a sincronização não registrou quais arquivos uniu neste PDF' };
  }
  return null;
}

// Para onde o documento vai ou foi: destinos da regra, situação em cada portal, protocolos, envio feito pelo robô (resultados.json)
// e o histórico de etapas da sincronização.
function destinoDe(x, rastro, regras, envioRobo) {
  const regra = regras.find((r) => r.doc_id === Number(x.doc_id));
  const previstos = [...new Set([...(rastro.regraDest?.get(String(x.doc_id)) || []).map((r) => r.destino), ...(regra?.destino ? [regra.destino] : [])])];
  const protos = rastro.protocolos.get(String(x.id)) || [];
  const proto = (p) => ({ plataforma: p.plataforma, protocolo: limpar(p.protocolo || ''), em: utc(p.data_protocolo), estado: p.estado_protocolo, texto: limpar(p.resultado_texto || '') });
  const portais = (rastro.destinos.get(String(x.id)) || []).map((d) => ({ destino: d.destino, estado: d.estado, situacao: d.situacao_portal, em: utc(d.atualizado_em),
    protocolos: protos.filter((p) => String(p.destino_id) === String(d.id)).map(proto) }));
  const soltos = protos.filter((p) => !p.destino_id || !portais.length).map(proto);
  const r = envioRobo[String(x.id)];
  return {
    previstos: previstos.length ? previstos : ['Atlas'], portais, protocolos: soltos, enviado_em: utc(x.enviado_em) || null,
    robo: r ? { acao: r.acao, ok: !!r.ok, msg: limpar(r.msg || ''), status_atlas: r.status_atlas || null, em: r.em } : null,
    historico: (rastro.envios?.get(String(x.id)) || []).slice(0, 20).map((e) => ({ etapa: e.etapa, status: e.status, em: utc(e.em), msg: limpar(e.mensagem_erro || '') })),
    erros: rastro.erros,
  };
}

// O Neon guarda toda pendência que o Atlas já mostrou; a que saiu do portal (entregue por outro meio, prazo mudou…) continua lá.
// Mesma chave do enviar.js: documento, CPF, CNPJ, pedido, unidade, competência e prazo, contra o pendencias.json da última coleta.
const normalizarAtlas = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const digitosAtlas = (s) => (s ? String(s).replace(/\D/g, '') : '');
const diaAtlas = (d) => (d == null ? '' : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const chaveAtlas = (r) => [normalizarAtlas(r.nome), digitosAtlas(r.cpf), digitosAtlas(r.cnpj_filial), r.numero_pedido ?? r.pedido ?? null,
  normalizarAtlas(r.unidade), r.competencia, diaAtlas(r.prazo_envio)].join('|');
function chavesColetaAtlas() {
  const p = lerJson(path.join(DADOS, 'pendencias-atlas', 'pendencias.json'));
  if (!p || !Array.isArray(p.pendencias) || !p.pendencias.length) return null;
  return new Set(p.pendencias.map(chaveColeta));
}
const chaveColeta = (l) => chaveAtlas({ nome: l.documento, cpf: l.cpf, cnpj_filial: l.cnpj_filial, pedido: l.pedido,
  unidade: l.unidades, competencia: l.competencia, prazo_envio: l.prazo_envio });
// Motivo da reprovação escrito pelo cliente no Atlas (o pendencias.js lê de cada reprovada), pela mesma chave.
// Data só com o dia: o Atlas manda a hora sem fuso. Para ordenar (mais recente primeiro) vai também a data inteira
// só com dígitos (20261028125459), que o utc() não converte.
function motivosColetaAtlas() {
  const p = lerJson(path.join(DADOS, 'pendencias-atlas', 'pendencias.json'));
  const m = new Map();
  for (const l of p?.pendencias || []) if (l.motivo_reprovacao) m.set(chaveColeta(l), { motivo: l.motivo_reprovacao, em: l.validado_em ? String(l.validado_em).slice(0, 10) : null,
    ord: l.validado_em ? String(l.validado_em).replace(/D/g, '').slice(0, 14) : null, obs: l.observacao_envio || null });
  return m;
}

// Pendências do Atlas no Neon (inclui as enviadas, para mostrar para onde foram), com todas as colunas menos as de identificação.
const COLUNAS_FORA = /^(cpf|colaborador_id|cnpj|cnpj_filial|rg|senha|token)$/i;
let cacheDocsNeon = { em: 0, dados: null };
async function documentosNeon() {
  if (!NEON) return { erro: 'ROBO_DATABASE_URL não configurada no painel.', linhas: [] };
  if (Date.now() - cacheDocsNeon.em < 60000 && cacheDocsNeon.dados) return cacheDocsNeon.dados;
  try {
    const linhas = await sql(`SELECT * FROM documentos ORDER BY atualizado_em DESC NULLS LAST LIMIT 2000`);
    const ids = linhas.map((x) => /^factorial:(\d+)$/i.exec(x.caminho_origem || '')?.[1]).filter(Boolean);
    const [rastro, rg] = await Promise.all([rastroNeon(), regrasNeon(), infoFactorialRapida(ids)]);
    const envioRobo = lerJson(path.join(DIR_ENVIO, 'resultados.json')) || {};
    // Por que a sincronização parou em cada documento (divergência, não achado, falta assinatura…): último alerta dele.
    // Se a tabela alerta não existir ou falhar, a lista sai sem o motivo.
    const alertas = new Map((await sql(`SELECT DISTINCT ON (documento_id) documento_id, descricao, criado_em FROM alerta
      ORDER BY documento_id, criado_em DESC`).catch(() => [])).map((a) => [String(a.documento_id), a]));
    arquivosAtlas.clear();
    const naColeta = chavesColetaAtlas();
    const motivos = motivosColetaAtlas();
    const shp = buscaSharepoint();
    const porIdShp = new Map((shp?.itens || []).map((i) => [String(i.id), i]));
    for (const x of linhas) {
      const al = alertas.get(String(x.id));
      if (al) { x.alerta = al.descricao; x.alerta_em = al.criado_em; }
      // Achado no SharePoint vale só enquanto a pendência continua PENDENTE_ENVIO (depois o banco manda).
      const sp = x.estado === 'PENDENTE_ENVIO' ? porIdShp.get(String(x.id)) : null;
      if (sp) x.sharepoint = resumoShp(sp, shp.em);
      const arq = pdfAtlas(x) || (sp?.achou ? existe(pdfShp(sp.local)) : null);
      if (arq) { arquivosAtlas.set(String(x.id), arq); x.pdf_atlas = `atlas-doc/${x.id}`; const t = tamanho(arq); x.pdf_kb = t?.kb ?? null; x.pdf_erro = t?.erro || null; }
      // Ainda aparece na última coleta do Atlas? (null = sem coleta para comparar)
      x.no_atlas = naColeta ? naColeta.has(chaveAtlas(x)) : null;
      const mr = motivos.get(chaveAtlas(x));
      if (mr) { x.motivo_reprovacao = mr.motivo; x.reprovado_em = mr.em; x.reprovado_ord = mr.ord; x.observacao_envio = mr.obs; }
      x.montagem = montagemDe(x, rastro, shp);
      x.destino = destinoDe(x, rastro, rg.regras || [], envioRobo);
    }
    cacheDocsNeon = { em: Date.now(), dados: { linhas: linhas.map((x) => Object.fromEntries(Object.entries(x)
      .filter(([k]) => !COLUNAS_FORA.test(k))
      .map(([k, v]) => [k, v == null ? null : typeof v === 'object' || typeof v === 'boolean' ? v : utc(limpar(v))]))) } };
  } catch (e) {
    cacheDocsNeon = { em: Date.now(), dados: { erro: e.message, linhas: [] } };
  }
  return cacheDocsNeon.dados;
}

// Regras dos documentos (documento_regras): de onde cada um vem (origem: Factorial ou SharePoint) e para onde vai (destino).
let cacheRegras = { em: 0, dados: null };
async function regrasNeon() {
  if (!NEON) return { erro: 'ROBO_DATABASE_URL não configurada no painel.', regras: [] };
  if (Date.now() - cacheRegras.em < 300000 && cacheRegras.dados) return cacheRegras.dados;
  try {
    const rs = await sql(`SELECT doc_id, nome, categoria, origem, destino, chave, periodicidade, requer_composicao
      FROM documento_regras WHERE ativo ORDER BY origem, destino, doc_id`);
    cacheRegras = { em: Date.now(), dados: { regras: rs.map((x) => ({ ...x, doc_id: Number(x.doc_id), requer_composicao: ['t', 'true', true].includes(x.requer_composicao) })) } };
  } catch (e) {
    cacheRegras = { em: Date.now(), dados: { erro: e.message, regras: [] } };
  }
  return cacheRegras.dados;
}

// Por que uma pendência do Atlas continua na fila (PENDENTE_ENVIO, sem nenhuma busca registrada): quem deveria buscar este tipo.
const SINC_FACTORIAL = new Set([8, 9, 10]); // SINC_DOCS do services/sincronizacao/rodar.py
const ROBO_FACTORIAL = new Set([67, 68, 69]); // tipos de arquivo único que o factorial.js do robô Atlas busca a cada leitura
function porQueNaFila(x, regra) {
  const doc = Number(x.doc_id);
  if (!regra) return { fila_grupo: 'sem_regra', fila_motivo: 'não buscado: o banco não tem regra de onde buscar este documento (falta em documento_regras)' };
  if (regra.origem === 'Factorial' && ROBO_FACTORIAL.has(doc)) {
    return { fila_grupo: 'robo', fila_motivo: 'ainda não buscado: o robô Atlas busca este tipo na Factorial a cada leitura e ainda não passou por esta pendência' };
  }
  if (regra.origem === 'Factorial' && SINC_FACTORIAL.has(doc)) {
    return { fila_grupo: 'evilasio', fila_motivo: `ainda não buscado: ${regra.requer_composicao ? 'este documento junta vários arquivos num PDF só e ' : ''}`
      + 'quem busca este tipo é a sincronização da Factorial (código do Evilásio, roda na VPS a cada 2 h, das 7h às 19h) e ela ainda não registrou motivo para esta pendência' };
  }
  if (regra.origem === 'Factorial') {
    return { fila_grupo: 'sem_busca', fila_motivo: 'não buscado: vem da Factorial, mas nenhum robô busca este tipo hoje. '
      + 'A sincronização só busca férias (8), TRCT (9) e GFD (10); o robô Atlas só busca ASO demissional (67), baixa na CTPS/e-Social (68) e pedido de demissão (69)' };
  }
  if (regra.origem === 'SharePoint') {
    return { fila_grupo: 'sharepoint', fila_motivo: 'ainda não buscado: a busca no SharePoint roda a cada leitura do robô Atlas e ainda não passou por esta pendência' };
  }
  return { fila_grupo: 'outra', fila_motivo: `não buscado: este documento vem de "${limpar(regra.origem || '?')}", e nenhum robô busca lá hoje` };
}

// ---------- Tabela única de pendências (aba Pendências) ----------
// Bernhoeft: cada "Não Entregue" do portal + o que a esteira achou na Factorial e o PDF montado.
// Atlas: cada linha não enviada do Neon + o estado que a sincronização da Factorial deu.
async function pendencias() {
  const b = estadoBernhoeft();
  const st = auto.estado();
  const mesma = (x, y) => x.contrato === y.contrato && x.descricao === y.descricao && (x.area || '') === (y.area || '');
  const bern = (b.pendentes || []).map((pe) => {
    const it = (st.itens || []).find((i) => mesma(i.pendencia, pe));
    const arquivos = (it?.arquivos || []).map((a) => ({ id: a.id, filename: limpar(a.filename), created_at: a.created_at, assinatura: a.signature_status || null,
      extensao: a.extension || null, pasta: a.pasta || null, paginas: a.paginas ?? null, parte: a.arquivo ? `auto/${it.pasta}/${a.arquivo}` : null, erro: a.erro || null, motivo: a.motivo }));
    return {
      origem: 'Bernhoeft', ...pe,
      documento: pe.descricao,
      tipo_reconhecido: it?.tipo || null,
      estado: it ? it.estado : st.rodando ? 'buscando' : 'sem_busca',
      confianca: it?.confianca || null, motivo: it?.motivo || null,
      arquivos, deixados: (it?.deixados || []).map((d) => ({ filename: limpar(d.filename), motivo: d.motivo })),
      pdf: it?.pdf || null, kb: it?.kb ?? null, unidos: it?.unidos ?? null,
      paginas: arquivos.reduce((s, a) => s + (a.paginas || 0), 0) || null,
      erro: it?.erro || null, buscado_em: st.inicio || null,
      destino: { previstos: ['Bernhoeft'], portais: [], protocolos: [], historico: [], erros: [],
        nota: 'o envio ao Bernhoeft está desativado: a conta atual não tem permissão de envio, então nada foi enviado' },
    };
  });
  const [n, rg] = await Promise.all([documentosNeon(), regrasNeon()]);
  const regraDe = new Map(rg.regras.map((r) => [String(r.doc_id), r]));
  // Bernhoeft: o que a esteira reconhece é buscado na Factorial; o resto (documentos de empresa) não tem regra.
  for (const l of bern) l.fonte = l.tipo_reconhecido ? 'Factorial' : null;
  // Busca do robô Atlas na Factorial (factorial.js, só 67/68/69): quem ele procurou e não achou continua PENDENTE_ENVIO
  // no banco, mas já foi buscado; o motivo vem de envio/busca.json.
  const buscaF = lerJson(path.join(DIR_ENVIO, 'busca.json'));
  const porIdF = new Map((buscaF?.itens || []).map((b) => [String(b.id), b]));
  // Pendência que não aparece mais na última coleta do Atlas sai da tabela (as enviadas ficam, para o rastro).
  const saiu = (x) => x.no_atlas === false && x.estado !== 'ENVIADO';
  const foraAtlas = (n.linhas || []).filter(saiu).length;
  const atlas = (n.linhas || []).filter((x) => !saiu(x)).map((x) => {
    const regra = regraDe.get(String(x.doc_id)), b = x.estado === 'PENDENTE_ENVIO' ? porIdF.get(String(x.id)) : null;
    const l = { origem: 'Atlas', ...x, documento: x.nome, estado: x.estado || '(vazio)', fonte: regra?.origem || null };
    if (b) l.busca_factorial = { em: buscaF.em || null, achou: !!b.achou, motivo: limpar(b.motivo || ''), factorial_id: b.factorial_id || null };
    else if (x.estado === 'PENDENTE_ENVIO' && !x.sharepoint) Object.assign(l, porQueNaFila(x, regra));
    return l;
  });
  return {
    agora: new Date().toISOString(),
    bernhoeft: { coletado_em: b.coletado_em, leituras_guardadas: b.leituras_guardadas, esteira: { inicio: st.inicio, fim: st.fim, rodando: st.rodando, erro: st.erro } },
    atlas: { erro: n.erro || null, fora_do_atlas: foraAtlas },
    linhas: [...bern, ...atlas],
  };
}

// ---------- Todos os PDFs que o painel pode mostrar (aba PDFs) ----------
const ATLAS_UNIDOS = path.join(DADOS, 'pendencias-atlas', 'unidos');
function tamanho(arq) { try { const s = fs.statSync(arq); return { kb: Math.round(s.size / 1024), em: s.mtime.toISOString(), erro: problemaPdf(arq, s.size) }; } catch { return null; } }
const erroParte = (arq) => { const t = tamanho(arq); return t ? t.erro : 'arquivo não está mais na VPS'; };
// Por que o visor não vai abrir este PDF (null = ok). Lê só o começo e o fim do arquivo.
function problemaPdf(arq, bytes) {
  let fd;
  try {
    fd = fs.openSync(arq, 'r');
    if (!bytes) return 'arquivo vazio (0 bytes)';
    const ler = (n, pos) => { const b = Buffer.alloc(Math.min(n, bytes)); fs.readSync(fd, b, 0, b.length, pos); return b.toString('latin1'); };
    if (!ler(5, 0).startsWith('%PDF-')) return 'o arquivo não é um PDF (não começa com %PDF-)';
    if (!ler(2048, Math.max(0, bytes - 2048)).includes('%%EOF')) return 'PDF cortado (falta o fim do arquivo): baixar de novo';
    return null;
  } catch (e) {
    return e.code === 'EACCES' ? 'o painel não tem permissão para ler este arquivo (gravado por outro usuário na VPS)' : `não deu para ler o arquivo (${e.code || e.message})`;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
async function listarPdfs() {
  const lista = [];
  // Atlas: o arquivo exato que o enviar.js manda para cada pendência (o mesmo que aparece na aba Pendências).
  const n = await documentosNeon();
  for (const l of n.linhas || []) {
    const t = l.pdf_atlas && tamanho(arquivosAtlas.get(String(l.id)) || '');
    if (!t || l.sharepoint) continue;
    lista.push({ grupo: l.estado === 'ENVIADO' ? 'Robô Atlas · já enviados ao portal' : 'Robô Atlas · o que vai para o portal', titulo: `#${l.id} · ${l.nome}`, sub: `${l.funcionario || '—'} · ${l.competencia || ''} · ${l.estado}`,
      url: l.pdf_atlas, ...t, paginas: paginasPdf(arquivosAtlas.get(String(l.id))), partes: [] });
  }
  // SharePoint (busca do robô Atlas com --baixar): arquivo único achado ou PDF unido das partes, ainda não gravado no banco.
  for (const l of n.linhas || []) {
    const t = l.sharepoint?.achou && l.pdf_atlas && tamanho(arquivosAtlas.get(String(l.id)) || '');
    if (!t) continue;
    lista.push({ grupo: 'SharePoint · achados (ainda não gravados no banco)', titulo: `#${l.id} · ${l.nome}`,
      sub: `${l.unidade || '—'} · ${l.competencia || ''} · ${l.sharepoint.arquivo}`, url: l.pdf_atlas, ...t,
      paginas: paginasPdf(arquivosAtlas.get(String(l.id))), partes: l.sharepoint.unido ? l.sharepoint.partes.filter((p) => p.url) : [] });
  }
  // Várias partes que o robô não conseguiu unir (falta parte, parte repetida, arquivo sem papel): uma entrada por pasta, partes separadas.
  const porPasta = new Map();
  for (const l of n.linhas || []) {
    const s = l.sharepoint, ps = (s?.partes || []).filter((p) => p.url);
    if (!ps.length || s.achou) continue;
    const k = `${l.doc_id}|${s.pasta}`;
    if (porPasta.has(k)) { porPasta.get(k).ids.push(l.id); continue; }
    const e = { grupo: 'SharePoint · várias partes (não deu para unir)', titulo: l.nome, ids: [l.id], competencia: l.competencia, pasta: s.pasta,
      url: ps[0].url, sem_uniao: true, em: s.em, kb: ps.reduce((x, p) => x + (p.kb || 0), 0),
      paginas: ps.reduce((x, p) => x + (p.paginas || 0), 0) || null, erro: null, partes: ps };
    porPasta.set(k, e);
    lista.push(e);
  }
  for (const e of porPasta.values()) {
    e.sub = `${e.competencia || ''} · ${String(e.pasta || '').split('/').slice(-2).join('/')} · vale para ${e.ids.length} pendência(s): ${e.ids.map((i) => '#' + i).join(' ')}`;
    delete e.ids; delete e.competencia; delete e.pasta;
  }
  const st = auto.estado();
  for (const it of st.itens || []) {
    // Documento de colaborador (auto.js, 30/10): um PDF por colaborador.
    for (const c of it.por_colaborador ? it.colaboradores || [] : []) {
      const t = c.pdf && tamanho(path.join(pacote.PACOTES, c.pdf));
      if (!t) continue;
      const sub = pacote.slug(c.nome);
      lista.push({
        grupo: 'Esteira automática Bernhoeft', titulo: `${it.pendencia.contrato} · ${it.tipo || it.pendencia.descricao} · ${c.nome}`,
        sub: it.pendencia.descricao, url: `pacotes/${c.pdf}`, ...t, confianca: c.confianca, motivo: c.motivo,
        paginas: c.arquivos.reduce((s, a) => s + (a.paginas || 0), 0) || null,
        partes: c.arquivos.filter((a) => a.arquivo).map((a) => ({ nome: limpar(a.filename), url: `pacotes/auto/${it.pasta}/${sub}/${a.arquivo}`, paginas: a.paginas ?? null,
          erro: erroParte(path.join(pacote.PACOTES, 'auto', it.pasta, sub, a.arquivo)),
          id: a.id, created_at: a.created_at, assinatura: a.signature_status || null, pasta: a.pasta || null })),
      });
    }
    if (!it.pdf) continue;
    const t = tamanho(path.join(pacote.PACOTES, it.pdf));
    if (!t) continue;
    lista.push({
      grupo: 'Esteira automática Bernhoeft', titulo: `${it.pendencia.contrato} · ${it.tipo || it.pendencia.descricao}`,
      sub: it.pendencia.descricao, url: `pacotes/${it.pdf}`, ...t, confianca: it.confianca, motivo: it.motivo,
      paginas: it.arquivos.reduce((s, a) => s + (a.paginas || 0), 0) || null,
      partes: it.arquivos.filter((a) => a.arquivo).map((a) => ({ nome: limpar(a.filename), url: `pacotes/auto/${it.pasta}/${a.arquivo}`, paginas: a.paginas ?? null,
        erro: erroParte(path.join(pacote.PACOTES, 'auto', it.pasta, a.arquivo)),
        id: a.id, created_at: a.created_at, assinatura: a.signature_status || null, pasta: a.pasta || null })),
    });
  }
  for (const p of listarPacotes()) {
    const t = tamanho(path.join(pacote.PACOTES, p.pasta, 'pacote.pdf'));
    if (!t) continue;
    const arqs = p.itens.flatMap((it) => it.arquivos.map((a) => ({ ...a, doc: it.nome })));
    lista.push({
      grupo: p.empresa ? 'Montados à mão · empresa' : 'Montados à mão · funcionário',
      titulo: p.empresa ? p.titulo : p.funcionario.nome, sub: p.empresa ? `${p.achados} arquivo(s) unido(s)` : `CPF ${p.funcionario.cpf} · ${p.achados} de ${p.exigidos} documentos`,
      url: `pacotes/${p.pasta}/pacote.pdf`, ...t, paginas: arqs.reduce((s, a) => s + (a.paginas || 0), 0) || null,
      partes: arqs.filter((a) => a.arquivo).map((a) => ({ nome: limpar(a.filename), url: `pacotes/${p.pasta}/${a.arquivo}`, paginas: a.paginas ?? null,
        erro: erroParte(path.join(pacote.PACOTES, p.pasta, a.arquivo)),
        id: a.id, created_at: a.created_at, assinatura: a.signature_status || null, pasta: a.pasta || null, doc: a.doc })),
    });
  }
  return lista;
}
// Páginas de um PDF sem biblioteca (conta os objetos /Type /Page); null se não der para ler.
const cachePaginas = new Map();
function paginasPdf(arq) {
  try {
    const k = `${arq}|${fs.statSync(arq).mtimeMs}`;
    if (!cachePaginas.has(k)) cachePaginas.set(k, (fs.readFileSync(arq).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null);
    return cachePaginas.get(k);
  } catch { return null; }
}

// ---------- Saúde de serviços HTTP ----------
async function saude(url) {
  try { const r = await comTempo(url, {}, 3000); return r.ok ? 'ok' : `HTTP ${r.status}`; } catch (e) { return 'fora do ar'; }
}

// Uniões de PDF que passaram pelo Gotenberg (linhas de log da rota de merge).
async function unioesGotenberg() {
  try {
    const ls = await logs(PDF, 2000);
    const u = ls.filter((l) => UNIAO.test(l.texto));
    return { total: u.length, ultima: u.length ? u[u.length - 1].em : null };
  } catch (e) { return { erro: e.message }; }
}

async function estado() {
  const [cs, atlas, neon, gotenberg, n8n, unioes] = await Promise.all([
    containers().catch((e) => ({ erro: e.message })),
    estadoAtlas(),
    estadoNeon(),
    saude(`${GOTENBERG}/health`),
    saude(`${N8N}/healthz`),
    unioesGotenberg(),
  ]);
  return { agora: new Date().toISOString(), containers: cs, atlas, bernhoeft: estadoBernhoeft(), neon, gotenberg, n8n, unioes, sharepoint: estadoSharepoint() };
}

// Linha do tempo: logs dos robôs e do PDF, juntos e em ordem.
async function linhaDoTempo(n) {
  const fontes = [['Atlas', ATLAS], ['Bernhoeft', BERNHOEFT], ['PDF', PDF]];
  const todas = [];
  for (const [rotulo, nome] of fontes) {
    try { for (const l of await logs(nome, n)) todas.push({ ...l, fonte: rotulo }); } catch {}
  }
  return todas.sort((a, b) => a.em.localeCompare(b.em)).slice(-n);
}

// ---------- Ao vivo: tudo o que acontece, na hora, para a página (Server-Sent Events) ----------
// Fontes: logs dos containers (seguidos com follow=1), eventos do Docker (start/die/health), passo a passo da esteira
// e dos pacotes, ações no painel, leituras novas dos robôs e mudanças de estado no Neon.
const EventEmitter = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(200);
const vivo = []; // últimos eventos, para quem abre a página já ver o histórico
const MAX_VIVO = 3000;
let seqVivo = 0, clientesVivo = 0;
function nivelDe(t) {
  if (/ERRO|Error|FALH|falhou|✕|RateLimit|rate limit|Sem Permissão|died|unhealthy|não encontrado/i.test(t)) return 'erro';
  if (/aviso|expirad|aguard|código|tentativa|esperando|PENDENTE|Não Entregue|! /i.test(t)) return 'aviso';
  if (/✓|→ PDF pronto|pronto|gravad|Login feito|Sessão ok|logou|NOVA|Coletado|healthy|start\b|Fim:/i.test(t)) return 'ok';
  return 'info';
}
function evento(fonte, texto, nivel, em) {
  const ev = { id: ++seqVivo, em: em || new Date().toISOString(), fonte, texto: limpar(texto), nivel: nivel || nivelDe(texto) };
  vivo.push(ev);
  if (vivo.length > MAX_VIVO) vivo.splice(0, vivo.length - MAX_VIVO);
  bus.emit('ev', ev);
}
auto.ouvir((m) => evento('Esteira', m));

// Segue o log de um container para sempre (reconecta se o container reiniciar ou a conexão cair).
// Carimbo do Docker em nanossegundos (RFC3339Nano corta zeros): normaliza para comparar texto e não repetir linhas.
const carimbo = (ts) => { const [s, f = ''] = ts.replace(/Z$/, '').split('.'); return `${s}.${f.padEnd(9, '0')}`; };
async function seguir(rotulo, nome) {
  let ultimo = null;
  for (;;) {
    try {
      const desde = ultimo ? `since=${Math.floor(Date.parse(ultimo.slice(0, 19) + 'Z') / 1000)}` : 'tail=200';
      const r = await fetch(`${DOCKER}/containers/${encodeURIComponent(nome)}/logs?stdout=1&stderr=1&timestamps=1&follow=1&${desde}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let buf = Buffer.alloc(0), resto = '', mux = null;
      const linha = (l) => {
        const i = l.indexOf(' ');
        if (i < 0) return;
        const ts = l.slice(0, i), k = carimbo(ts);
        if (ultimo && k <= ultimo) return;
        ultimo = k;
        let t = l.slice(i + 1).replace(/^\[\d\d:\d\d:\d\d\]\s*/, '');
        if (nome === PDF) t = linhaPdf(t);
        if (!t || /ExperimentalWarning|trace-warnings/.test(t)) return;
        evento(rotulo, t, null, new Date(ts).toISOString());
      };
      const texto = (s) => { resto += s; const ps = resto.split('\n'); resto = ps.pop(); ps.forEach((l) => l && linha(l.replace(/\r$/, ''))); };
      for await (const pedaco of r.body) {
        buf = Buffer.concat([buf, Buffer.from(pedaco)]);
        if (mux === null) {
          if (buf.length < 8) continue; // espera o cabeçalho inteiro para decidir
          mux = buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
        }
        if (!mux) { texto(buf.toString('utf8')); buf = Buffer.alloc(0); continue; }
        while (buf.length >= 8) {
          const n = buf.readUInt32BE(4);
          if (buf.length < 8 + n) break;
          texto(buf.subarray(8, 8 + n).toString('utf8'));
          buf = buf.subarray(8 + n);
        }
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 3000));
  }
}
const NAVEGACAO = process.env.CONTAINER_NAVEGACAO || 'gesdoc-navegacao-hml-navegacao-1';
for (const [rotulo, nome] of [['Atlas', ATLAS], ['Bernhoeft', BERNHOEFT], ['PDF', PDF], ['Navegação', NAVEGACAO]]) seguir(rotulo, nome);

// Eventos do Docker: container subiu, caiu, reiniciou, ficou (des)saudável.
const ACOES_DOCKER = { start: 'subiu', die: 'parou', restart: 'reiniciou', stop: 'foi parado', kill: 'foi encerrado', oom: 'ficou sem memória', 'health_status: healthy': 'está saudável', 'health_status: unhealthy': 'NÃO está saudável (unhealthy)' };
async function seguirDocker() {
  let ultimo = 0; // timeNano do último evento: ao reconectar, pede desde ele e pula os repetidos
  for (;;) {
    try {
      const filtro = encodeURIComponent(JSON.stringify({ type: ['container'] }));
      const r = await fetch(`${DOCKER}/events?filters=${filtro}${ultimo ? `&since=${Math.floor(ultimo / 1e9)}` : ''}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      let resto = '';
      for await (const pedaco of r.body) {
        resto += Buffer.from(pedaco).toString('utf8');
        const ps = resto.split('\n'); resto = ps.pop();
        for (const l of ps) {
          let e; try { e = JSON.parse(l); } catch { continue; }
          const quando = Number(e.timeNano) || e.time * 1e9;
          if (quando <= ultimo) continue;
          ultimo = quando;
          const nome = e.Actor?.Attributes?.name || '';
          const acao = ACOES_DOCKER[e.Action];
          if (!acao || !PREFIXOS.some((p) => nome.startsWith(p))) continue;
          const saida = e.Action === 'die' && e.Actor.Attributes.exitCode ? ` (código de saída ${e.Actor.Attributes.exitCode})` : '';
          evento('Docker', `${nome} ${acao}${saida}`, /parou|encerrado|memória|NÃO/.test(acao) ? 'erro' : 'ok', new Date(quando / 1e6).toISOString());
        }
      }
    } catch {}
    await new Promise((ok) => setTimeout(ok, 10000));
  }
}
seguirDocker();

// Leituras novas dos robôs (arquivo pendencias.json mudou) e mudanças de estado no Neon.
const vistos = { bernhoeft: null, atlas: null, neon: null };
async function vigiarVivo() {
  const b = lerJson(path.join(DADOS, 'pendencias-bernhoeft', 'pendencias.json'));
  if (b?.coletado_em && b.coletado_em !== vistos.bernhoeft) {
    if (vistos.bernhoeft) {
      const pend = (b.itens || []).filter((i) => i.docs_pendentes).length;
      evento('Bernhoeft', `Leitura nova gravada: ${b.total ?? (b.itens || []).length} item(ns) no portal, ${pend} "Não Entregue"`, 'ok', b.coletado_em);
    }
    vistos.bernhoeft = b.coletado_em;
  }
  const a = lerJson(path.join(DADOS, 'pendencias-atlas', 'pendencias.json'));
  if (a?.coletado_em && a.coletado_em !== vistos.atlas) {
    if (vistos.atlas) evento('Atlas', `Coleta nova gravada: ${(a.pendencias || []).length} pendência(s)`, 'ok', a.coletado_em);
    vistos.atlas = a.coletado_em;
  }
  // Neon só enquanto alguém olha a página (o banco é serverless: não acordar à toa).
  if (NEON && clientesVivo > 0) {
    try {
      if (!vistos.neon) {
        vistos.neon = (await sql('SELECT max(atualizado_em)::text AS m FROM documentos'))[0]?.m || '1970-01-01';
      } else {
        // Só dígitos e separadores de data (o valor veio do próprio banco, mas vai dentro do SQL).
        const desde = String(vistos.neon).replace(/[^0-9:.+ -]/g, '');
        const ls = await sql(`SELECT nome, competencia, unidade, estado, atualizado_em::text AS em FROM documentos
          WHERE atualizado_em > '${desde}' ORDER BY atualizado_em LIMIT 50`);
        for (const l of ls) evento('Neon', `${l.nome || '?'} · ${l.competencia || ''} · ${l.unidade || ''} → ${l.estado} (gravado no banco às ${String(l.em).slice(11, 16)})`, /NAO_|DIVERG|ERRO/.test(l.estado) ? 'aviso' : 'ok');
        if (ls.length) { vistos.neon = ls[ls.length - 1].em; cacheNeon.em = 0; cacheDocsNeon.em = 0; }
      }
    } catch (e) { /* sem rede para o Neon: o cartão do banco já mostra o erro */ }
  }
}
setInterval(vigiarVivo, 20000);
setTimeout(vigiarVivo, 2000);

function aoVivo(req, res, url) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  const desde = Number(req.headers['last-event-id'] || url.searchParams.get('desde') || 0);
  const mandar = (ev) => res.write(`id: ${ev.id}\ndata: ${JSON.stringify(ev)}\n\n`);
  // Histórico em ordem de horário (os logs dos containers chegam misturados na partida).
  vivo.filter((ev) => ev.id > desde).sort((x, y) => x.em.localeCompare(y.em)).forEach(mandar);
  bus.on('ev', mandar);
  clientesVivo++;
  const pulso = setInterval(() => res.write(`event: pulso\ndata: ${JSON.stringify({ agora: new Date().toISOString(), clientes: clientesVivo })}\n\n`), 15000);
  req.on('close', () => { bus.off('ev', mandar); clearInterval(pulso); clientesVivo--; });
}

// ---------- Pacotes Bernhoeft (Factorial -> PDF único, para conferir) ----------
let tarefa = null; // uma montagem por vez: { busca, inicio, log[], fim, erro, pasta, candidatos }
// ids presente = documento de empresa (IDs da Factorial unidos nessa ordem); senão, pacote do funcionário.
function iniciarPacote(busca, ids) {
  tarefa = { busca, inicio: new Date().toISOString(), log: [] };
  const t = tarefa;
  const log = (m) => { t.log.push(limpar(m)); evento('Pacotes', m); };
  evento('Pacotes', `Montando ${ids ? `documento de empresa "${busca}" (${ids.length} arquivo(s))` : `pacote do funcionário "${busca}"`}…`, 'info');
  (ids ? pacote.montarEmpresa(busca, ids, log) : pacote.montar(busca, log))
    .then((r) => { t.pasta = r.pasta; evento('Pacotes', `Pacote pronto: ${r.achados} de ${r.exigidos}`, 'ok'); })
    .catch((e) => { t.erro = limpar(e.message); t.candidatos = e.candidatos || null; evento('Pacotes', `ERRO: ${e.message}`, 'erro'); })
    .finally(() => { t.fim = new Date().toISOString(); });
}
function listarPacotes() {
  let dirs = [];
  try { dirs = fs.readdirSync(pacote.PACOTES); } catch {}
  return dirs.map((d) => {
    const r = lerJson(path.join(pacote.PACOTES, d, 'resumo.json'));
    return r && { pasta: d, ...r };
  }).filter(Boolean).sort((a, b) => b.gerado_em.localeCompare(a.gerado_em));
}
// ?baixar=1 = download com o nome do arquivo; sem isso abre no visor do navegador.
function servirPdf(res, base, rel, baixar, nomeBaixar) {
  const arq = path.resolve(base, rel);
  if (!arq.startsWith(path.resolve(base) + path.sep) || !/\.pdf$/i.test(arq) || !fs.existsSync(arq)) {
    return json(res, 404, { erro: 'arquivo não encontrado' });
  }
  // Arquivo sem permissão de leitura (ex.: gravado por root com 600) responde erro; sem isso o stream derrubava o painel inteiro.
  try { fs.accessSync(arq, fs.constants.R_OK); } catch (e) {
    return json(res, 403, { erro: `o painel não tem permissão para ler este PDF (${e.code})` });
  }
  // pacote.pdf baixa com o nome da pasta (ex.: 3562026-ma-brigada-de-incendio.pdf).
  const nome = nomeBaixar || (path.basename(arq) === 'pacote.pdf' ? `${path.basename(path.dirname(arq))}.pdf` : path.basename(arq));
  res.writeHead(200, {
    'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-length': fs.statSync(arq).size,
    'content-disposition': baixar ? `attachment; filename*=UTF-8''${encodeURIComponent(nome)}` : 'inline',
  });
  fs.createReadStream(arq).on('error', () => res.destroy()).pipe(res);
  if (!baixar && path.basename(arq) === 'pacote.pdf') evento('Painel', `PDF aberto no visor: ${limpar(path.relative(base, arq).split(path.sep).join('/'))}`, 'info');
}
const dataBr = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
// ---------- Esteira automática Bernhoeft (auto.js) ----------
// A cada leitura nova do robô Bernhoeft, roda sozinha: pendências -> Factorial -> PDF pronto para subir.
let reiniciadoEm = null; // depois de "Reiniciar", só roda com uma leitura feita DEPOIS do pedido
function vigiarAuto() {
  const b = estadoBernhoeft();
  const st = auto.estado();
  // Já feito = terminou sem erro (rodada cortada por reinício do painel não conta; com erro, tenta de novo após 10 min).
  const feito = st.fim && (!st.erro || Date.now() - new Date(st.fim) < 600000) ? st.coletado_em : null;
  if (!pacote.temChave() || !b.coletado_em || b.coletado_em === feito || st.rodando) return;
  if (reiniciadoEm && new Date(b.coletado_em) <= reiniciadoEm) return;
  evento('Esteira', `Leitura nova do Bernhoeft (${dataBr(b.coletado_em)}): a esteira automática começa sozinha`, 'info');
  auto.rodar(b.pendentes || [], b.coletado_em, 'nova leitura do Bernhoeft');
}
setInterval(vigiarAuto, 30000);
setTimeout(vigiarAuto, 5000);

function reiniciar(alvo) {
  const feito = [];
  if (alvo === 'bernhoeft' || alvo === 'tudo') {
    auto.limpar();
    reiniciadoEm = new Date();
    fs.writeFileSync(SINAL_BERNHOEFT, new Date().toISOString() + '\n');
    feito.push('Bernhoeft: PDFs automáticos apagados e leitura nova pedida ao robô');
  }
  if (alvo === 'atlas' || alvo === 'tudo') {
    fs.writeFileSync(SINAL_ATLAS, new Date().toISOString() + '\n');
    feito.push('Atlas: coleta nova pedida (vai chegar um código por e-mail para digitar no painel)');
  }
  console.log(`[${new Date().toISOString()}] reiniciar pelo painel: ${alvo}`);
  for (const f of feito) evento('Painel', `Reiniciar pelo painel → ${f}`, 'aviso');
  return feito;
}
function estadoAuto() {
  return { ...auto.estado(), tem_chave: pacote.temChave(), reiniciado_em: reiniciadoEm,
    sinal: { bernhoeft: fs.existsSync(SINAL_BERNHOEFT), atlas: fs.existsSync(SINAL_ATLAS) } };
}

// ---------- Envio ao Atlas (aba Envio) ----------
// O painel NÃO envia nada: grava a escolha e os pedidos em /codigo/envio (= out/envio do robô Atlas) e o robo.js,
// dentro do container do Atlas, executa em fila. modo.json = interruptores "Envio liberado" (geral) e automático;
// pedidos/*.json = verificar/enviar um por um; segurar.json = pendências que não saem (nem no automático).
const DIR_ENVIO = path.join(path.dirname(ARQ_CODIGO), 'envio');
const PEDIDOS_ENVIO = path.join(DIR_ENVIO, 'pedidos');
const SIM_ATLAS = path.join(path.dirname(ARQ_CODIGO), 'enviar-simulacao.json');
// Pendência que não aparece mais na última coleta do Atlas (sem document_schedule_id): não é problema, só sai da lista de envio.
// Ambígua (mais de uma igual no Atlas) continua na lista, como problema.
function foraDoAtlas(i) {
  return !i.schedule_id && (i.motivos || []).some((m) => /^sem document_schedule_id na coleta/.test(m));
}
function lerModo() {
  const m = lerJson(path.join(DIR_ENVIO, 'modo.json')) || {};
  const liberado = m.liberado === true;
  return { liberado, automatico: liberado && m.automatico === true, alterado_em: m.alterado_em || null };
}
const lerSegurar = () => lerJson(path.join(DIR_ENVIO, 'segurar.json')) || {};
function pedidosPendentes() {
  try { return fs.readdirSync(PEDIDOS_ENVIO).filter((f) => f.endsWith('.json')).sort().map((f) => lerJson(path.join(PEDIDOS_ENVIO, f))).filter(Boolean); } catch { return []; }
}
// Ficha de cada PDF antes do envio: para onde vai no Atlas, de que pasta veio, como foi montado e que arquivos leva dentro.
const ATLAS_URL = process.env.ATLAS_URL || 'https://gestao.atlasfacilities.com.br';
function fichaEnvio(i, l, regra, r) {
  const m = l?.montagem;
  const arq = arquivosAtlas.get(String(i.id));
  const pastas = [...new Set((m?.itens || []).map((p) => p.pasta).filter(Boolean))];
  const fonte = m?.itens?.[0]?.origem || (/^sharepoint:/i.test(l?.caminho_origem || '') ? 'SharePoint' : 'Factorial');
  let como;
  if (!m) como = 'sem registro de como o PDF foi montado';
  else if (m.tipo === 'único') como = `arquivo único, enviado como está na ${fonte} (sem unir nem alterar)`;
  else if (m.por === 'robô (SharePoint)') como = `PDF unido pelo robô na VPS (Gotenberg), ${m.itens.length} parte(s) na ordem relação de beneficiários → boleto → comprovante (complementar logo depois)`;
  else como = `PDF unido pela ${m.por || 'sincronização'}${m.itens.length ? `, ${m.itens.length} parte(s) nesta ordem` : ''}`;
  if (i.montado_aqui) como += '; montado de novo na VPS com as mesmas partes (o arquivo não é o mesmo que o banco registrou)';
  return {
    destino: {
      portal: 'Atlas', documento: i.nome, nome_atlas: r?.nome_atlas || null, status_atlas: r?.status_atlas || null, conferido_em: r?.em || null,
      unidade: l?.unidade || null, competencia: i.competencia || null, prazo: l?.prazo_envio || null, pedido: l?.numero_pedido || null,
      funcionario: l?.funcionario || null, schedule_id: i.schedule_id || null,
      url: i.schedule_id ? `${ATLAS_URL}/document-schedule/${encodeURIComponent(i.schedule_id)}/general-information?resume=false` : null,
    },
    origem: { fonte, pastas, regra: regra ? `${regra.doc_id} · ${limpar(regra.nome || '')}` : `doc ${i.doc_id}`, regra_origem: regra?.origem || null },
    organizacao: { tipo: m?.tipo || null, como, paginas: arq ? paginasPdf(arq) : null, kb: i.tamanho ? Math.round(i.tamanho / 1024) : null,
      sha256: i.hash ? i.hash.slice(0, 12) : null, final: m?.final ? limpar(m.final) : null },
    partes: (m?.itens || []).map((p, k) => ({ ordem: k + 1, ...p, url: p.url || (m.tipo === 'único' && arq ? `atlas-doc/${i.id}` : null) })),
    // Unido pela sincronização sem lista de partes: hoje ela não grava quais arquivos usou (só o PDF final chega à VPS).
    nota: m?.tipo === 'unido' && !m.itens.length && /Evilásio/.test(m.por || '')
      ? 'a sincronização do Evilásio não registra quais arquivos uniu (na VPS só existe o PDF final): conferir página por página em "Ver PDF" antes de enviar'
      : m?.nota || null,
    aviso: m?.aviso || null, deixados: m?.deixados || [],
  };
}
// Histórico dos envios ao Atlas: resultados.json guarda só a última ação de cada pendência (um "verificar" depois
// apagaria o envio), então todo envio ok é copiado para historico-envios.json e nunca sai de lá. Sem CPF nem arquivo.
const ARQ_HISTORICO = path.join(DIR_ENVIO, 'historico-envios.json');
function historicoEnvios(res, todos, porId) {
  const hist = lerJson(ARQ_HISTORICO);
  const lista = Array.isArray(hist) ? hist : [];
  const tem = new Set(lista.map((x) => `${x.id}|${x.em}`));
  const doSim = new Map(todos.map((i) => [String(i.id), i]));
  let novos = 0;
  for (const [id, r] of Object.entries(res)) {
    if (r.acao !== 'enviar' || !r.ok || !r.em || tem.has(`${id}|${r.em}`)) continue;
    const i = doSim.get(String(id)), l = porId.get(String(id));
    lista.push({ id: Number(id) || id, nome: i?.nome || l?.nome || null, competencia: i?.competencia || l?.competencia || null,
      em: r.em, auto: !!r.auto, status_atlas: r.status_atlas ?? null, schedule_id: r.schedule_id || i?.schedule_id || null, msg: limpar(r.msg || '') });
    novos++;
  }
  if (novos) {
    try {
      fs.mkdirSync(DIR_ENVIO, { recursive: true });
      fs.writeFileSync(ARQ_HISTORICO + '.tmp', JSON.stringify(lista, null, 2));
      fs.renameSync(ARQ_HISTORICO + '.tmp', ARQ_HISTORICO);
    } catch (e) { console.error('histórico de envios:', e.message); }
  }
  // situacao/estado = como está agora no Neon (a coleta do Atlas atualiza): mostra se o enviado foi reprovado depois.
  return lista.map((x) => ({ ...x, funcionario: porId.get(String(x.id))?.funcionario || null,
    situacao: porId.get(String(x.id))?.situacao || null, estado: porId.get(String(x.id))?.estado || null,
    motivo_reprovacao: porId.get(String(x.id))?.motivo_reprovacao || null }))
    .sort((a, b) => String(b.em).localeCompare(String(a.em)));
}
async function estadoEnvio() {
  const sim = lerJson(SIM_ATLAS) || {};
  const res = lerJson(path.join(DIR_ENVIO, 'resultados.json')) || {};
  const robo = lerJson(path.join(DIR_ENVIO, 'robo.json'));
  const busca = lerJson(path.join(DIR_ENVIO, 'busca.json'));
  const [n, rg] = await Promise.all([documentosNeon(), regrasNeon()]);
  const porId = new Map((n.linhas || []).map((l) => [String(l.id), l]));
  const regraDe = new Map((rg.regras || []).map((r) => [String(r.doc_id), r]));
  const todos = (sim.itens || []).map((i) => ({
    id: i.id, doc_id: i.doc_id, nome: i.nome, competencia: i.competencia, estado: i.estado, schedule_id: i.schedule_id, pronta: i.pronta,
    motivos: (i.motivos || []).map(limpar), kb: i.tamanho ? Math.round(i.tamanho / 1024) : null, montado_aqui: !!i.montado_aqui,
    funcionario: porId.get(String(i.id))?.funcionario || null, pdf: arquivosAtlas.has(String(i.id)) ? `atlas-doc/${i.id}` : null,
    situacao: porId.get(String(i.id))?.situacao || null, unidade: porId.get(String(i.id))?.unidade || null,
    motivo_reprovacao: porId.get(String(i.id))?.motivo_reprovacao || null, reprovado_em: porId.get(String(i.id))?.reprovado_em || null,
    observacao_envio: porId.get(String(i.id))?.observacao_envio || null,
    resultado: res[i.id] ? { ...res[i.id], msg: limpar(res[i.id].msg || '') } : null,
    ficha: fichaEnvio(i, porId.get(String(i.id)), regraDe.get(String(i.doc_id)), res[i.id]),
    hash: i.hash || null,
  }));
  // Mesmo arquivo (SHA-256) em pendências de funcionários diferentes = arquivo errado em alguém: a ficha avisa
  // (o enviar.js novo também trava; o aviso fica aqui para valer mesmo com a imagem antiga do robô).
  // Compara com todas, inclusive as que saíram do Atlas: o arquivo continua errado em quem ficou.
  const porHash = new Map();
  for (const i of todos) if (i.hash) porHash.set(i.hash, [...(porHash.get(i.hash) || []), i]);
  for (const i of todos) {
    const outros = (porHash.get(i.hash) || []).filter((x) => x !== i && x.funcionario && x.funcionario !== i.funcionario);
    if (outros.length) i.ficha.aviso = [i.ficha.aviso, `o mesmo arquivo (mesmo SHA-256) está na pendência de outro funcionário: #${outros.map((x) => x.id).join(', #')}. Conferir de quem é antes de enviar`].filter(Boolean).join('; ');
  }
  for (const i of todos) delete i.hash;
  // Segurada no painel: vale na hora (o enviar.js também lê o segurar.json antes de montar a fila).
  const seg = lerSegurar();
  for (const i of todos) {
    const s = seg[i.id];
    if (!s) continue;
    i.segurada = { motivo: limpar(s.motivo || ''), em: s.em || null };
    i.pronta = false;
    if (!i.motivos.some((m) => /^segurada no painel/.test(m))) i.motivos.unshift(`segurada no painel${s.motivo ? ': ' + limpar(s.motivo) : ''}`);
  }
  // Enviadas saem da lista na hora (a simulação do robô só é refeita na próxima rodada) e vão para o histórico.
  const enviados = historicoEnvios(res, todos, porId);
  const jaFoi = new Set(enviados.map((x) => String(x.id)));
  const ativos = todos.filter((i) => !jaFoi.has(String(i.id)) && porId.get(String(i.id))?.estado !== 'ENVIADO');
  const itens = ativos.filter((i) => !foraDoAtlas(i));
  const fora_do_atlas = ativos.length - itens.length;
  // robo.json é regravado a cada 5 s; parado há mais de 2 min sem estar ocupado = robô antigo ou fora do ar.
  const vivo = robo && (robo.fazendo || Date.now() - new Date(robo.agora) < 120000);
  // Situação agora das que já saíram (enviadas ou reprovadas), para o diagnóstico dos "enviados com erro" na página.
  const situacoes = Object.fromEntries((n.linhas || []).filter((l) => ['ENVIADO', 'REJEITADO'].includes(l.estado))
    .map((l) => [l.id, { situacao: l.situacao || null, estado: l.estado, atualizado_em: l.atualizado_em || null,
      motivo_reprovacao: l.motivo_reprovacao || null, reprovado_em: l.reprovado_em || null, observacao_envio: l.observacao_envio || null }]));
  return { agora: new Date().toISOString(), modo: lerModo(), robo, robo_ok: !!vivo, lista_em: sim.gerado_em || null, itens, fora_do_atlas, enviados, situacoes, pedidos: pedidosPendentes(),
    busca: busca ? { em: busca.em, itens: (busca.itens || []).map((x) => ({ ...x, motivo: limpar(x.motivo || '') })) } : null };
}
function gravarNoEnvio(nome, obj, dir = DIR_ENVIO) {
  fs.mkdirSync(path.join(dir, 'pedidos'), { recursive: true });
  const tmp = path.join(dir, `.${nome.replace(/\//g, '_')}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, path.join(dir, nome)); // troca inteira: o robô nunca lê um arquivo pela metade
}

// ---------- Envio ao Bernhoeft (aba 7) ----------
// Mesmo desenho do Atlas: o painel só grava a escolha e os pedidos em /sinal-bernhoeft/envio (= out/envio do robô Bernhoeft);
// o pendencias.js --loop atende com o entregar.js entre as leituras. modo.json { liberado, automatico, confianca } começa DESLIGADO
// (sem o arquivo = bloqueado). segurar.json (por chave) = não sai no automático. auto.json = rodada automática da última leitura.
// Enviar exige: envio liberado, PDF pronto na esteira e uma verificação "pode enviar" recente do MESMO documento (objeto_id = confirmo).
const DIR_ENVIO_BERN = path.join(path.dirname(SINAL_BERNHOEFT), 'envio');
const VERIF_BERN_MAX_H = 6;
// Automático (entregar.js automatico()): só vale com liberado; confianca = a menor que sai sozinha (alta | media | baixa).
const CONF_BERN = ['alta', 'media', 'baixa'];
const lerModoBern = () => {
  const m = lerJson(path.join(DIR_ENVIO_BERN, 'modo.json')) || {};
  const liberado = m.liberado === true;
  return { liberado, automatico: liberado && m.automatico === true, confianca: CONF_BERN.includes(m.confianca) ? m.confianca : 'alta', alterado_em: m.alterado_em || null };
};
const lerSegurarBern = () => lerJson(path.join(DIR_ENVIO_BERN, 'segurar.json')) || {};
function pedidosBern() {
  try { const d = path.join(DIR_ENVIO_BERN, 'pedidos'); return fs.readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => lerJson(path.join(d, f))).filter(Boolean); } catch { return []; }
}
function estadoEnvioBern() {
  const res = lerJson(path.join(DIR_ENVIO_BERN, 'resultados.json')) || {};
  const resultados = Object.fromEntries(Object.entries(res).map(([k, r]) => [k, { ...r, msg: limpar(r.msg || ''), motivos: (r.motivos || []).map(limpar) }]));
  const enviados = Object.entries(resultados).filter(([, r]) => r.acao === 'enviar' && r.ok).map(([chave, r]) => ({ chave, ...r }))
    .sort((a, b) => b.em.localeCompare(a.em)).slice(0, 50);
  const a = lerJson(path.join(DIR_ENVIO_BERN, 'auto.json'));
  const autoBern = a ? { coletado_em: a.coletado_em || null, tentados: Object.keys(a.tentados || {}).length, parado: a.parado ? limpar(a.parado) : null, parado_em: a.parado_em || null } : null;
  return { agora: new Date().toISOString(), modo: lerModoBern(), resultados, enviados, segurar: lerSegurarBern(), auto: autoBern,
    pedidos: pedidosBern().map((p) => ({ acao: p.acao, chave: p.chave, pedido_em: p.pedido_em })) };
}

// POST só da própria página (evita que outro site acione pelo navegador).
function origemOk(req) {
  const origem = req.headers.origin;
  return (!origem || new URL(origem).host === req.headers.host) && /application\/json/.test(req.headers['content-type'] || '');
}

function corpo(req) {
  return new Promise((ok, falha) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1000) req.destroy(); });
    req.on('end', () => ok(s));
    req.on('error', falha);
  });
}
function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(PAGINA));
    }
    if (req.method === 'GET' && url.pathname === '/api/estado') return json(res, 200, await estado());
    if (req.method === 'GET' && url.pathname === '/api/linha') {
      return json(res, 200, await linhaDoTempo(Math.min(Number(url.searchParams.get('n')) || 300, 2000)));
    }
    if (req.method === 'GET' && url.pathname === '/api/log') {
      const nome = url.searchParams.get('c') || '';
      const cs = await containers();
      if (!cs.some((c) => c.nome === nome)) return json(res, 404, { erro: 'container desconhecido' });
      return json(res, 200, await logs(nome, Math.min(Number(url.searchParams.get('n')) || 300, 3000)));
    }
    if (req.method === 'GET' && url.pathname === '/api/pacotes') {
      return json(res, 200, { tem_chave: pacote.temChave(), tarefa, pacotes: listarPacotes() });
    }
    if (req.method === 'GET' && url.pathname.startsWith('/pacotes/')) {
      return servirPdf(res, pacote.PACOTES, decodeURIComponent(url.pathname.slice('/pacotes/'.length)), url.searchParams.has('baixar'));
    }
    if (req.method === 'GET' && url.pathname.startsWith('/pdf-atlas/')) {
      return servirPdf(res, ATLAS_UNIDOS, decodeURIComponent(url.pathname.slice('/pdf-atlas/'.length)), url.searchParams.has('baixar'));
    }
    // PDF de uma pendência do Atlas pelo id do Neon (o nome do arquivo tem CPF: não aparece na URL nem no download).
    const doc = req.method === 'GET' && /^\/atlas-doc\/(\d+)$/.exec(url.pathname);
    if (doc) {
      if (!arquivosAtlas.has(doc[1])) await documentosNeon();
      const arq = arquivosAtlas.get(doc[1]);
      if (!arq) return json(res, 404, { erro: 'PDF desta pendência não está na VPS' });
      const base = arq.startsWith(SINC_DOWNLOADS + path.sep) ? SINC_DOWNLOADS : ATLAS_DOWNLOADS;
      return servirPdf(res, base, path.relative(base, arq), url.searchParams.has('baixar'), `atlas-${doc[1]}.pdf`);
    }
    // Partes baixadas do SharePoint (benefícios), pelo id do item.
    const shpArq = req.method === 'GET' && /^\/sharepoint\/([A-Za-z0-9!_-]+\.pdf)$/.exec(url.pathname);
    if (shpArq) return servirPdf(res, SHP_DIR, shpArq[1], url.searchParams.has('baixar'));
    if (req.method === 'GET' && url.pathname === '/api/ao-vivo') return aoVivo(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/pendencias') return json(res, 200, await pendencias());
    if (req.method === 'GET' && url.pathname === '/api/regras') return json(res, 200, await regrasNeon());
    if (req.method === 'GET' && url.pathname === '/api/pdfs') return json(res, 200, await listarPdfs());
    if (req.method === 'POST' && url.pathname === '/api/pacote') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      if (!pacote.temChave()) return json(res, 400, { erro: 'Falta a chave da Factorial (FACTORIAL_API_KEY) no cofre.' });
      if (tarefa && !tarefa.fim) return json(res, 409, { erro: `Já estou montando o pacote de "${tarefa.busca}".` });
      const pedido = JSON.parse((await corpo(req)) || '{}');
      const busca = String(pedido.busca || '').trim().slice(0, 120);
      if (pedido.empresa) {
        const ids = String(pedido.ids || '').split(/[^0-9]+/).filter(Boolean).slice(0, 20);
        if (busca.length < 3) return json(res, 400, { erro: 'Digite o título do documento.' });
        if (!ids.length) return json(res, 400, { erro: 'Digite os IDs dos arquivos da Factorial (na ordem).' });
        iniciarPacote(busca, ids);
        return json(res, 200, { ok: true });
      }
      if (busca.length < 3) return json(res, 400, { erro: 'Digite o nome (ou CPF) do funcionário.' });
      iniciarPacote(busca);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/auto') return json(res, 200, estadoAuto());
    if (req.method === 'POST' && url.pathname === '/api/auto/rodar') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      if (!pacote.temChave()) return json(res, 400, { erro: 'Falta a chave da Factorial (FACTORIAL_API_KEY) no cofre.' });
      if (auto.estado().rodando) return json(res, 409, { erro: 'A esteira já está rodando.' });
      const b = estadoBernhoeft();
      if (!b.coletado_em) return json(res, 400, { erro: 'O robô Bernhoeft ainda não gravou nenhuma leitura.' });
      evento('Painel', 'Botão "Rodar a busca agora": esteira automática começando', 'info');
      auto.rodar(b.pendentes || [], b.coletado_em, 'pedido no painel');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/reiniciar') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      const alvo = String(JSON.parse((await corpo(req)) || '{}').alvo || '');
      if (!['bernhoeft', 'atlas', 'tudo'].includes(alvo)) return json(res, 400, { erro: 'alvo inválido' });
      if (auto.estado().rodando && alvo !== 'atlas') return json(res, 409, { erro: 'Espere a esteira terminar (leva uns minutos).' });
      return json(res, 200, { ok: true, feito: reiniciar(alvo) });
    }
    if (req.method === 'GET' && url.pathname === '/api/envio') return json(res, 200, await estadoEnvio());
    if (req.method === 'POST' && url.pathname === '/api/envio/modo') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      // Corpo { liberado } e/ou { automatico }: o que não vier fica como está. Bloquear o envio desliga o automático junto.
      const b = JSON.parse((await corpo(req)) || '{}');
      const antes = lerModo();
      const liberado = 'liberado' in b ? b.liberado === true : antes.liberado;
      const pediuAuto = 'automatico' in b ? b.automatico === true : liberado && antes.automatico;
      if (pediuAuto && !liberado) return json(res, 400, { erro: 'Libere o envio primeiro (interruptor "Envio liberado").' });
      const automatico = liberado && pediuAuto;
      gravarNoEnvio('modo.json', { liberado, automatico, alterado_em: new Date().toISOString() });
      console.log(`[${new Date().toISOString()}] painel: envio ${liberado ? 'LIBERADO' : 'BLOQUEADO'}, automático ${automatico ? 'LIGADO' : 'desligado'}`);
      if (liberado !== antes.liberado) evento('Painel', liberado ? 'Envio ao Atlas LIBERADO: o botão "Enviar" passa a funcionar' : 'Envio ao Atlas BLOQUEADO: nada sai, nem pelo botão nem no automático', liberado ? 'aviso' : 'ok');
      if (automatico !== antes.automatico) evento('Painel', automatico ? 'Envio automático LIGADO: o robô Atlas busca na Factorial e envia sozinho as prontas' : 'Envio automático DESLIGADO: nada sai sozinho; envio só um por um', automatico ? 'aviso' : 'ok');
      return json(res, 200, { ok: true, liberado, automatico });
    }
    if (req.method === 'POST' && url.pathname === '/api/envio/segurar') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      const b = JSON.parse((await corpo(req)) || '{}');
      const id = String(b.id || '');
      if (!/^\d+$/.test(id)) return json(res, 400, { erro: 'id inválido' });
      const seg = lerSegurar();
      if (b.segurar === false) delete seg[id];
      else seg[id] = { motivo: String(b.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 200), em: new Date().toISOString() };
      gravarNoEnvio('segurar.json', seg);
      // O robô refaz a lista (a segurada sai das prontas; a solta volta, se estiver pronta).
      if (!pedidosPendentes().some((x) => x.acao === 'atualizar')) gravarNoEnvio(`pedidos/${Date.now()}-atualizar.json`, { acao: 'atualizar', pedido_em: new Date().toISOString() });
      evento('Painel', b.segurar === false ? `#${id} solto: pode voltar a sair` : `#${id} segurado: não sai nem no automático`, 'info');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/envio/pedido') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      const p = JSON.parse((await corpo(req)) || '{}');
      const acao = String(p.acao || '');
      if (!['verificar', 'enviar', 'buscar', 'atualizar'].includes(acao)) return json(res, 400, { erro: 'ação inválida' });
      const pedido = { acao, pedido_em: new Date().toISOString() };
      if (acao === 'verificar' || acao === 'enviar') {
        const id = String(p.id || '');
        const item = ((lerJson(SIM_ATLAS) || {}).itens || []).find((i) => String(i.id) === id);
        if (!item) return json(res, 404, { erro: `#${id} não está na lista de envio.` });
        if (acao === 'enviar') {
          // Mesma trava do enviar.js: envio liberado, não segurada, só a pronta, e o local tem que ser o que a pessoa viu na tela.
          if (!lerModo().liberado) return json(res, 409, { erro: 'O envio está bloqueado: ligue "Envio liberado" na aba Envio ao Atlas.' });
          if (lerSegurar()[id]) return json(res, 400, { erro: `#${id} está segurada no painel: solte antes de enviar.` });
          if (!item.pronta) return json(res, 400, { erro: `#${id} não está pronta: ${limpar((item.motivos || []).join('; '))}` });
          if (String(p.confirmo || '') !== item.schedule_id) return json(res, 400, { erro: 'O local no Atlas mudou desde que a lista foi carregada: atualize a página.' });
          pedido.confirmo = item.schedule_id;
        }
        pedido.id = item.id;
      }
      if (pedidosPendentes().some((x) => x.acao === acao && String(x.id ?? '') === String(pedido.id ?? ''))) return json(res, 409, { erro: 'Esse pedido já está na fila do robô.' });
      gravarNoEnvio(`pedidos/${Date.now()}-${acao}${pedido.id ? '-' + pedido.id : ''}.json`, pedido);
      evento('Painel', `Pedido ao robô Atlas: ${{ verificar: 'verificar', enviar: 'ENVIAR', buscar: 'buscar na Factorial', atualizar: 'atualizar a lista' }[acao]}${pedido.id ? ` #${pedido.id}` : ''}`, acao === 'enviar' ? 'aviso' : 'info');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/envio-bern') return json(res, 200, estadoEnvioBern());
    if (req.method === 'POST' && url.pathname === '/api/envio-bern/modo') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      // Corpo { liberado } e/ou { automatico } e/ou { confianca }: o que não vier fica como está. Bloquear desliga o automático junto.
      const b = JSON.parse((await corpo(req)) || '{}');
      const antes = lerModoBern();
      const liberado = 'liberado' in b ? b.liberado === true : antes.liberado;
      const pediuAuto = 'automatico' in b ? b.automatico === true : liberado && antes.automatico;
      if (pediuAuto && !liberado) return json(res, 400, { erro: 'Libere o envio primeiro (interruptor "Envio liberado").' });
      if ('confianca' in b && !CONF_BERN.includes(b.confianca)) return json(res, 400, { erro: 'confiança inválida' });
      const automatico = liberado && pediuAuto, confianca = b.confianca || antes.confianca;
      gravarNoEnvio('modo.json', { liberado, automatico, confianca, alterado_em: new Date().toISOString() }, DIR_ENVIO_BERN);
      console.log(`[${new Date().toISOString()}] painel: envio ao Bernhoeft ${liberado ? 'LIBERADO' : 'BLOQUEADO'}, automático ${automatico ? `LIGADO (confiança ${confianca} ou mais)` : 'desligado'}`);
      if (liberado !== antes.liberado) evento('Painel', liberado ? 'Envio ao Bernhoeft LIBERADO: o botão "Enviar" da aba 7 passa a funcionar' : 'Envio ao Bernhoeft BLOQUEADO: nada sai, nem pelo botão nem no automático', liberado ? 'aviso' : 'ok');
      const quais = { alta: 'só confiança alta', media: 'confiança alta e média', baixa: 'todas as prontas, até confiança baixa' };
      if (automatico !== antes.automatico) evento('Painel', automatico ? `Envio automático ao Bernhoeft LIGADO (${quais[confianca]}): o robô envia sozinho a cada leitura` : 'Envio automático ao Bernhoeft DESLIGADO: só um por um', automatico ? 'aviso' : 'ok');
      else if (automatico && confianca !== antes.confianca) evento('Painel', `Envio automático ao Bernhoeft: agora saem ${quais[confianca]}`, 'aviso');
      return json(res, 200, { ok: true, liberado, automatico, confianca });
    }
    if (req.method === 'POST' && url.pathname === '/api/envio-bern/segurar') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      const b = JSON.parse((await corpo(req)) || '{}');
      const chave = String(b.chave || '');
      const seg = lerSegurarBern();
      const item = (auto.estado().itens || []).find((i) => i.pendencia?.chave === chave);
      if (!item && !seg[chave]) return json(res, 404, { erro: 'Essa pendência não está na lista da esteira.' });
      if (b.segurar === false) delete seg[chave];
      else seg[chave] = { motivo: String(b.motivo || '').replace(/\s+/g, ' ').trim().slice(0, 150), em: new Date().toISOString() };
      gravarNoEnvio('segurar.json', seg, DIR_ENVIO_BERN);
      const nome = item ? `${limpar(item.pendencia.contrato)} · ${limpar(item.tipo || item.pendencia.descricao)}` : 'pendência';
      evento('Painel', b.segurar === false ? `Bernhoeft: ${nome} solto, pode sair no automático` : `Bernhoeft: ${nome} segurado, não sai no automático`, 'info');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/envio-bern/pedido') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      const p = JSON.parse((await corpo(req)) || '{}');
      const acao = String(p.acao || ''), chave = String(p.chave || '');
      if (!['verificar', 'enviar'].includes(acao)) return json(res, 400, { erro: 'ação inválida' });
      const item = (auto.estado().itens || []).find((i) => i.pendencia?.chave === chave);
      if (!item) return json(res, 404, { erro: 'Essa pendência não está na lista da esteira: clique em "Buscar na Factorial".' });
      const pedido = { acao, chave, pedido_em: new Date().toISOString() };
      if (acao === 'enviar') {
        // Mesmas travas do entregar.js (ele confere tudo de novo no portal antes de subir).
        if (!lerModoBern().liberado) return json(res, 409, { erro: 'O envio está bloqueado: ligue "Envio liberado" no alto da aba 7.' });
        if (item.estado !== 'pronto' || !item.pdf) return json(res, 400, { erro: 'A esteira não montou o PDF desta pendência.' });
        const v = (lerJson(path.join(DIR_ENVIO_BERN, 'resultados.json')) || {})[chave];
        if (!v || v.acao !== 'verificar' || !v.ok) return json(res, 400, { erro: 'Clique em "Verificar" antes: o robô precisa conferir o documento no portal.' });
        if (Date.now() - new Date(v.em) > VERIF_BERN_MAX_H * 3600000) return json(res, 400, { erro: `A verificação tem mais de ${VERIF_BERN_MAX_H} h: verifique de novo.` });
        if (String(p.confirmo || '') !== String(v.objeto_id)) return json(res, 400, { erro: 'O documento no portal mudou desde que a tela foi carregada: atualize a página.' });
        pedido.confirmo = v.objeto_id;
      }
      if (pedidosBern().some((x) => x.chave === chave)) return json(res, 409, { erro: 'Já há um pedido desta pendência na fila do robô.' });
      gravarNoEnvio(`pedidos/${Date.now()}-${acao}.json`, pedido, DIR_ENVIO_BERN);
      evento('Painel', `Pedido ao robô Bernhoeft: ${acao === 'enviar' ? 'ENVIAR' : 'verificar'} ${limpar(item.pendencia.contrato)} · ${limpar(item.tipo || item.pendencia.descricao)}`, acao === 'enviar' ? 'aviso' : 'info');
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/codigo') {
      if (!origemOk(req)) return json(res, 403, { erro: 'origem não permitida' });
      const codigo = String(JSON.parse((await corpo(req)) || '{}').codigo || '').replace(/[^0-9a-z]/gi, '');
      if (codigo.length !== 8) return json(res, 400, { erro: 'O código do Atlas tem 8 letras/números.' });
      fs.writeFileSync(ARQ_CODIGO, codigo + '\n');
      console.log(`[${new Date().toISOString()}] código do Atlas gravado pelo painel`);
      evento('Painel', 'Código de 2FA do Atlas gravado pelo painel: o robô lê em até 2 s', 'ok');
      return json(res, 200, { ok: true });
    }
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    json(res, 500, { erro: limpar(e.message) });
  }
});

// O IP do Tailscale pode ainda não existir quando o container sobe: tenta de novo até conseguir.
function escutar() {
  servidor.once('error', (e) => {
    if (e.code === 'EADDRNOTAVAIL') { console.log(`${ESCUTAR} ainda não existe; tentando de novo em 10 s`); return setTimeout(escutar, 10000); }
    throw e;
  });
  servidor.listen(PORTA, ESCUTAR, () => { console.log(`Painel em http://${ESCUTAR}:${PORTA}`); evento('Painel', 'Painel no ar', 'ok'); });
}
escutar();
