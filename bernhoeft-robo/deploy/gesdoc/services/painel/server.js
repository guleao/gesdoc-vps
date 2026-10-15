// Painel da automação de documentos (homologação): mostra o que os robôs estão fazendo, de ponta a ponta.
// Só leitura nos portais e na Factorial. Escreve apenas: o código de 2FA do Atlas (8 letras/números) em codigo.txt,
// que o robô lê e apaga, o sinal "rodar-agora" dos robôs (botão Reiniciar) e os pacotes Bernhoeft em PACOTES
// (manuais: pacote.js; automáticos, a cada leitura nova do Bernhoeft: auto.js).
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
const NEON = process.env.ROBO_DATABASE_URL;
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
  try { ls = await logs(ATLAS, 400); } catch (e) { r.erro_log = e.message; }
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
  if (sim) r.simulacao = { gerado_em: sim.gerado_em, itens: (sim.itens || []).length };
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
    const estados = await sql('SELECT coalesce(estado, \'(vazio)\') AS estado, count(*)::int AS n FROM documentos GROUP BY 1 ORDER BY 2 DESC');
    const recentes = await sql(`SELECT nome, competencia, unidade, estado, funcionario, atualizado_em, enviado_em
      FROM documentos WHERE atualizado_em IS NOT NULL ORDER BY atualizado_em DESC LIMIT 30`);
    // Com Neon-Raw-Text-Output os números chegam como texto.
    cacheNeon = { em: Date.now(), dados: { estados: estados.map((x) => ({ estado: x.estado, n: Number(x.n) })), recentes: recentes.map((x) => ({ ...x, funcionario: limpar(x.funcionario || '') })) } };
  } catch (e) {
    cacheNeon = { em: Date.now(), dados: { erro: e.message } };
  }
  return cacheNeon.dados;
}

// Pendências do Atlas no Neon (tudo que não foi enviado), com todas as colunas menos as de identificação.
const COLUNAS_FORA = /^(cpf|colaborador_id|cnpj|cnpj_filial|rg|senha|token)$/i;
let cacheDocsNeon = { em: 0, dados: null };
async function documentosNeon() {
  if (!NEON) return { erro: 'ROBO_DATABASE_URL não configurada no painel.', linhas: [] };
  if (Date.now() - cacheDocsNeon.em < 60000 && cacheDocsNeon.dados) return cacheDocsNeon.dados;
  try {
    const linhas = await sql(`SELECT * FROM documentos WHERE coalesce(estado, '') <> 'ENVIADO'
      ORDER BY atualizado_em DESC NULLS LAST LIMIT 2000`);
    cacheDocsNeon = { em: Date.now(), dados: { linhas: linhas.map((x) => Object.fromEntries(Object.entries(x)
      .filter(([k]) => !COLUNAS_FORA.test(k))
      .map(([k, v]) => [k, v == null ? null : limpar(v)]))) } };
  } catch (e) {
    cacheDocsNeon = { em: Date.now(), dados: { erro: e.message, linhas: [] } };
  }
  return cacheDocsNeon.dados;
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
    };
  });
  const n = await documentosNeon();
  const atlas = (n.linhas || []).map((x) => ({ origem: 'Atlas', ...x, documento: x.nome, estado: x.estado || '(vazio)' }));
  return {
    agora: new Date().toISOString(),
    bernhoeft: { coletado_em: b.coletado_em, leituras_guardadas: b.leituras_guardadas, esteira: { inicio: st.inicio, fim: st.fim, rodando: st.rodando, erro: st.erro } },
    atlas: { erro: n.erro || null },
    linhas: [...bern, ...atlas],
  };
}

// ---------- Todos os PDFs que o painel pode mostrar (aba PDFs) ----------
const ATLAS_UNIDOS = path.join(DADOS, 'pendencias-atlas', 'unidos');
function tamanho(arq) { try { const s = fs.statSync(arq); return { kb: Math.round(s.size / 1024), em: s.mtime.toISOString() }; } catch { return null; } }
function listarPdfs() {
  const lista = [];
  const st = auto.estado();
  for (const it of st.itens || []) {
    if (!it.pdf) continue;
    const t = tamanho(path.join(pacote.PACOTES, it.pdf));
    if (!t) continue;
    lista.push({
      grupo: 'Esteira automática Bernhoeft', titulo: `${it.pendencia.contrato} · ${it.tipo || it.pendencia.descricao}`,
      sub: it.pendencia.descricao, url: `pacotes/${it.pdf}`, ...t, confianca: it.confianca, motivo: it.motivo,
      paginas: it.arquivos.reduce((s, a) => s + (a.paginas || 0), 0) || null,
      partes: it.arquivos.filter((a) => a.arquivo).map((a) => ({ nome: limpar(a.filename), url: `pacotes/auto/${it.pasta}/${a.arquivo}`, paginas: a.paginas ?? null,
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
        id: a.id, created_at: a.created_at, assinatura: a.signature_status || null, pasta: a.pasta || null, doc: a.doc })),
    });
  }
  let unidos = [];
  try { unidos = fs.readdirSync(ATLAS_UNIDOS, { recursive: true }).filter((f) => /\.pdf$/i.test(f)); } catch {}
  for (const f of unidos) {
    const t = tamanho(path.join(ATLAS_UNIDOS, f));
    if (t) lista.push({ grupo: 'Robô Atlas · PDFs unidos', titulo: limpar(path.basename(f)), sub: limpar(path.dirname(f)), url: `pdf-atlas/${f.split(path.sep).join('/')}`, ...t, partes: [] });
  }
  return lista;
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
  return { agora: new Date().toISOString(), containers: cs, atlas, bernhoeft: estadoBernhoeft(), neon, gotenberg, n8n, unioes };
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
function servirPdf(res, base, rel, baixar) {
  const arq = path.resolve(base, rel);
  if (!arq.startsWith(path.resolve(base) + path.sep) || !/\.pdf$/i.test(arq) || !fs.existsSync(arq)) {
    return json(res, 404, { erro: 'arquivo não encontrado' });
  }
  // pacote.pdf baixa com o nome da pasta (ex.: 3562026-ma-brigada-de-incendio.pdf).
  const nome = path.basename(arq) === 'pacote.pdf' ? `${path.basename(path.dirname(arq))}.pdf` : path.basename(arq);
  res.writeHead(200, {
    'content-type': 'application/pdf', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-length': fs.statSync(arq).size,
    'content-disposition': baixar ? `attachment; filename*=UTF-8''${encodeURIComponent(nome)}` : 'inline',
  });
  fs.createReadStream(arq).pipe(res);
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
    if (req.method === 'GET' && url.pathname === '/api/ao-vivo') return aoVivo(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/pendencias') return json(res, 200, await pendencias());
    if (req.method === 'GET' && url.pathname === '/api/pdfs') return json(res, 200, listarPdfs());
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
