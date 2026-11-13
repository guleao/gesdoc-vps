// Painel "Solicitações ODA NIP": pendentes, enviados, status dos envios, alertas e o que o sistema processou.
// Lê só a view v_solicitacoes e as tabelas de apoio (migrações em /migracoes), com a role painel_leitura (só SELECT).
// Sem dependências: node server.js. Acesso só pela rede do Tailscale (ESCUTAR = IP do Tailscale).
//
// Variáveis:
//   PAINEL_DATABASE_URL  conexão do Neon com a role painel_leitura (obrigatória; vem do cofre)
//   ESCUTAR              IP em que escuta (padrão 127.0.0.1; na VPS, o IP do Tailscale)
//   PORTA                porta (padrão 3022)
//   CACHE_SEGUNDOS       por quanto tempo uma resposta do banco é reaproveitada (padrão 60)
//
// Rotas:
//   GET /                    a página
//   GET /api/consultas       lista das consultas (id, título, se usa o período)
//   GET /api/dados/<id>      linhas de uma consulta; ?periodo=hoje|ontem|7d|30d nas que usam período
//   GET /saude               200 se o banco responde
const http = require('http');
const fs = require('fs');
const path = require('path');

const ESCUTAR = process.env.ESCUTAR || '127.0.0.1';
const PORTA = Number(process.env.PORTA || 3022);
const NEON = process.env.PAINEL_DATABASE_URL;
const CACHE_MS = Number(process.env.CACHE_SEGUNDOS || 60) * 1000;
const PAGINA = path.join(__dirname, 'pagina.html');
const CONSULTAS = JSON.parse(fs.readFileSync(path.join(__dirname, 'consultas.json'), 'utf8'));
const PERIODOS = ['hoje', 'ontem', '7d', '30d'];

// Nada de URL de banco nem CPF em mensagem de erro.
const limpar = (s) => String(s)
  .replace(/postgres(ql)?:\/\/\S+/g, '<url>')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***')
  .replace(/(?<!\d)\d{11}(?!\d)/g, '***');

async function comTempo(url, opts, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ac.signal }); } finally { clearTimeout(t); }
}

// Neon pela API HTTPS (sem driver), como o painel da automação.
async function sql(query) {
  const host = new URL(NEON).hostname.replace(/^[^.]+\./, 'api.');
  const r = await comTempo(`https://${host}/sql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Neon-Connection-String': NEON, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'false' },
    body: JSON.stringify({ query, params: [] }),
  }, 20000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(limpar(j.message || `Neon respondeu ${r.status}`));
  return j.rows;
}

const cache = new Map();
async function dados(id, periodo) {
  const c = CONSULTAS[id];
  if (!c) return { status: 404, corpo: { erro: 'consulta desconhecida' } };
  const usa = c.sql.includes('{{periodo}}');
  if (usa && !PERIODOS.includes(periodo)) return { status: 400, corpo: { erro: 'período inválido' } };
  const chave = usa ? `${id}|${periodo}` : id;
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < CACHE_MS) return { status: 200, corpo: guardado.corpo };
  const query = usa ? c.sql.split('{{periodo}}').join(periodo) : c.sql;
  const linhas = await sql(query);
  const corpo = { id, periodo: usa ? periodo : null, em: new Date().toISOString(), linhas };
  cache.set(chave, { em: Date.now(), corpo });
  return { status: 200, corpo };
}

function json(res, status, corpo) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method !== 'GET') return json(res, 405, { erro: 'só leitura' });
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(PAGINA));
    }
    if (url.pathname === '/api/consultas') {
      return json(res, 200, Object.entries(CONSULTAS).map(([id, c]) => ({ id, titulo: c.titulo, usa_periodo: c.sql.includes('{{periodo}}') })));
    }
    const m = url.pathname.match(/^\/api\/dados\/([a-z_]+)$/);
    if (m) {
      if (!NEON) return json(res, 500, { erro: 'PAINEL_DATABASE_URL não configurada' });
      const r = await dados(m[1], url.searchParams.get('periodo') || 'hoje');
      return json(res, r.status, r.corpo);
    }
    if (url.pathname === '/saude') {
      if (!NEON) return json(res, 500, { ok: false, erro: 'PAINEL_DATABASE_URL não configurada' });
      await sql('select 1');
      return json(res, 200, { ok: true });
    }
    json(res, 404, { erro: 'não encontrado' });
  } catch (e) {
    json(res, 500, { erro: limpar(e.message) });
  }
});

function escutar() {
  servidor.once('error', (e) => {
    if (e.code === 'EADDRNOTAVAIL') { console.log(`${ESCUTAR} ainda não existe; tentando de novo em 10 s`); return setTimeout(escutar, 10000); }
    throw e;
  });
  servidor.listen(PORTA, ESCUTAR, () => console.log(`Painel Solicitações ODA NIP em http://${ESCUTAR}:${PORTA}`));
}
escutar();
