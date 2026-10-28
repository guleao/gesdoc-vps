// Espelho do Atlas e do Bernhoeft: mostra, no formato dos portais, o que os robôs leram na VPS.
// Só lê: copia os out/pendencias.json dos containers pelo tailscale ssh e consulta o painel (GET).
// uso: node servidor.js   → abre http://127.0.0.1:3050
// As leituras do Atlas ficam guardadas em %LOCALAPPDATA%\gesdoc-espelho\atlas (fora do OneDrive: têm nome e CPF),
// para dar para comparar uma leitura com a anterior (o robô Atlas só guarda a última).
const http = require('http'), fs = require('fs'), path = require('path');
const { execFile } = require('child_process');

const PORTA = 3050;
const VPS = 'augusto@100.103.196.93';
const PAINEL = 'http://100.103.196.93:3020';
const TAILSCALE = 'C:\\Program Files\\Tailscale\\tailscale.exe';
const GIT_SSH = 'C:\\Program Files\\Git\\usr\\bin';
const C_ATLAS = 'gesdoc-pendencias-hml-atlas-1';
const C_BERN = 'gesdoc-pendencias-hml-bernhoeft-1';
const PAGINA_PAINEL = path.join(__dirname, '..', '..', 'bernhoeft-robo', 'deploy', 'gesdoc', 'services', 'painel', 'pagina.html');
const GUARDA =path.join(process.env.LOCALAPPDATA || '.', 'gesdoc-espelho', 'atlas');
fs.mkdirSync(GUARDA, { recursive: true });

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
    const coleta = JSON.parse(await remoto(`docker exec ${C_ATLAS} cat /app/out/pendencias.json`));
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
    return { coleta, nosso, banco, modo: env?.modo || null, enviados: env?.enviados || [], painel_ok: !!env, leituras: leiturasAtlas() };
  });
}

async function bern(novo) {
  return guardado('bern', novo, async () => {
    const coleta = JSON.parse(await remoto(`docker exec ${C_BERN} cat /app/out/pendencias.json`));
    const hist = (await remoto(`docker exec ${C_BERN} ls /app/out/historico`)).split(/\s+/).filter((f) => /^\d{4}-.*\.json$/.test(f)).sort().reverse();
    // O que a esteira achou para cada "Não Entregue" e o que o entregar.js enviou/conferiu.
    const [pend, env] = await Promise.all([painel('/api/pendencias'), painel('/api/envio-bern')]);
    const esteira = (pend?.linhas || []).filter((l) => l.origem === 'Bernhoeft').map((l) => ({
      chave: l.chave, contrato: l.contrato, descricao: l.descricao, area: l.area, estado: l.estado, confianca: l.confianca, motivo: l.motivo,
      tipo_reconhecido: l.tipo_reconhecido, arquivos: (l.arquivos || []).map((a) => a.filename), deixados: (l.deixados || []).length, erro: l.erro, buscado_em: l.buscado_em,
    }));
    return { coleta, leituras: hist, esteira, envio: env ? { modo: env.modo, enviados: env.enviados || [], resultados: env.resultados || {}, segurar: env.segurar || {} } : null, painel_ok: !!pend };
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
    const novo = u.searchParams.has('novo');
    if (u.pathname === '/api/atlas') return enviar(res, 200, await atlas(novo));
    if (u.pathname === '/api/bern') return enviar(res, 200, await bern(novo));
    if (u.pathname === '/api/atlas/leitura') {
      const arq = path.basename(u.searchParams.get('arq') || '');
      if (!leiturasAtlas().includes(arq)) return enviar(res, 404, { erro: 'leitura não guardada' });
      return enviar(res, 200, JSON.parse(fs.readFileSync(path.join(GUARDA, arq), 'utf8')));
    }
    if (u.pathname === '/api/bern/leitura') {
      const arq = u.searchParams.get('arq') || '';
      if (!/^\d{4}-\d\d-\d\dT[\d-]+Z\.json$/.test(arq)) return enviar(res, 400, { erro: 'nome inválido' });
      return enviar(res, 200, JSON.parse(await remoto(`docker exec ${C_BERN} cat /app/out/historico/${arq}`)));
    }
    enviar(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    enviar(res, 502, { erro: e.message });
  }
}).listen(PORTA, '127.0.0.1', () => console.log(`Espelho no ar: http://127.0.0.1:${PORTA}  (Ctrl+C para fechar)`));
