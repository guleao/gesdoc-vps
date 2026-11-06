// Verifica no Bernhoeft (ContractWeb) quais competências/documentos estão pendentes. SOMENTE LEITURA.
// - Usa o perfil salvo em profile/ (sessão). Se cair, faz login automático (login_auto.py, reCAPTCHA por áudio);
//   se isso falhar, espera você marcar o reCAPTCHA (com janela) ou sai com código 2 (headless).
// - Lê as telas "Carregamento Trabalhista/Mensal" (TipoCompetencia=0) e "Mobilização" (=1) pelo mesmo endpoint
//   JSON que a tela usa (ListarCompetenciasAjax), com paginação completa, e a quantidade de documentos pendentes.
// - Grava out/pendencias.json (estado atual), out/historico/ (cópias datadas) e out/mudancas.txt (novas/resolvidas).
// - Com --loop, entre as leituras atende os pedidos da aba 7 do painel e o envio automático (entregar.js). Enviar só com o
//   interruptor "Envio liberado" ligado (o automático, também com "Modo de envio" em Automático); a leitura continua só leitura.
// Uso: node pendencias.js            (uma leitura)
//      node pendencias.js --loop     (repete a cada INTERVALO_MIN, padrão 30)
//      node pendencias.js --concluidos  (inclui também as competências concluídas)
const { chromium } = require('playwright');
const fs = require('fs');
const ExcelJS = require('exceljs');
const path = require('path');
const { spawnSync } = require('child_process');
const entrega = require('./entregar');

const BASE = process.env.BERNHOEFT_URL || 'https://newcontract.contractweb.com.br';
const OUT = path.join(__dirname, 'out');
const HIST = path.join(OUT, 'historico');
const PROFILE = process.env.PROFILE_DIR || path.join(__dirname, 'profile');
// CHROME_PATH vazio => Chromium do Playwright (servidor). No Windows, usa o Chrome instalado.
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
// HEADLESS=1 (servidor): sem janela. Se a sessão cair, não espera login: avisa e sai com código 2.
const HEADLESS = process.env.HEADLESS === '1';
// Login automático do reCAPTCHA (login_auto.py, solver por áudio). AUTO_LOGIN=0 desliga e volta ao login manual.
const AUTO_LOGIN = process.env.AUTO_LOGIN !== '0';
const PYTHON_BIN =
  process.env.PYTHON_BIN ||
  [path.join(__dirname, '.venv-captcha', 'Scripts', 'python.exe'), path.join(__dirname, '.venv-captcha', 'bin', 'python')].find((p) => fs.existsSync(p)) ||
  'python3';
const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN || 30);
const LOOP = process.argv.includes('--loop');
const CONCLUIDOS = process.argv.includes('--concluidos');
const TELAS = [
  { nome: 'trabalhista', tipo: 0 },
  { nome: 'mobilizacao', tipo: 1 },
];

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const gravar = (arq, txt) => fs.writeFileSync(arq, txt, 'utf8');

// Aviso opcional por webhook (n8n, Slack, etc.): POST JSON {"texto": "..."}.
async function avisar(texto, extra = {}) {
  log(texto);
  if (!ALERT_WEBHOOK_URL) return;
  // No máximo 1 aviso a cada 6 h por mensagem, para não repetir a cada ciclo enquanto a sessão estiver caída.
  const marca = path.join(OUT, '.ultimo-aviso.json');
  try {
    const ult = JSON.parse(fs.readFileSync(marca, 'utf8'));
    if (ult.texto === texto && Date.now() - ult.em < 6 * 3600 * 1000) return;
  } catch {}
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(marca, JSON.stringify({ texto, em: Date.now() }), 'utf8');
  await fetch(ALERT_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto, ...extra }) }).catch(() => {});
}

const estaLogado = async (page) => (await page.$('#password')) === null;

// Desde 24/10 o login é em duas etapas: Login → "Continuar" → aparecem senha, reCAPTCHA e o botão Login.
async function preencherLogin(page) {
  await page.fill('#Login', process.env.BERNHOEFT_USER || '').catch(() => {});
  if (await page.isVisible('#BotaoContinuar').catch(() => false)) await page.click('#BotaoContinuar').catch(() => {});
  await page.waitForSelector('#password', { state: 'visible', timeout: 30000 }).catch(() => {});
  await page.fill('#password', process.env.BERNHOEFT_PASSWORD || '').catch(() => {});
}

async function garantirLogin(page) {
  await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (await estaLogado(page)) return;
  if (AUTO_LOGIN) {
    // O perfil só pode ser aberto por um navegador por vez: o main fecha o contexto, roda login_auto.py e reabre.
    const e = new Error('Sessão expirada: login automático necessário.');
    e.precisaLogin = true;
    throw e;
  }
  await preencherLogin(page);
  if (HEADLESS) {
    await avisar('Bernhoeft: sessão expirada. Faça login manual (node login.js) para renovar.');
    const e = new Error('Sessão expirada (modo headless).');
    e.codigo = 2;
    throw e;
  }
  log('Sessão fora. Marque o reCAPTCHA e clique em Login na janela (até 15 min).');
  await page.waitForSelector('#password', { state: 'detached', timeout: 900000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

// Abre a tela e captura a URL que a própria tela usa para listar; depois refaz o pedido com paginação própria.
async function lerTela(page, { nome, tipo }) {
  let urlLista = null;
  const aoResponder = (resp) => {
    if (resp.url().includes('/AtualizarColaborador/ListarCompetenciasAjax') && !urlLista) urlLista = resp.url();
  };
  page.on('response', aoResponder);
  await page.goto(`${BASE}/AtualizarColaborador?TipoCompetencia=${tipo}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  page.off('response', aoResponder);
  if (!urlLista) throw new Error(`Tela ${nome}: não consegui capturar a requisição de listagem.`);

  const TAM = 100;
  const linhas = [];
  for (let inicio = 0; ; inicio += TAM) {
    const u = new URL(urlLista);
    u.searchParams.set('start', String(inicio));
    u.searchParams.set('length', String(TAM));
    if (CONCLUIDOS) u.searchParams.set('concluido', 'on');
    else u.searchParams.delete('concluido');
    const json = await page.evaluate(async (url) => (await fetch(url, { credentials: 'same-origin' })).json(), u.toString());
    const dados = json.data || [];
    linhas.push(...dados);
    const total = Number(json.recordsFiltered ?? json.recordsTotal ?? linhas.length);
    if (!dados.length || linhas.length >= total) break;
  }

  // Quantidade de documentos pendentes por competência (só onde a tela sinaliza pendência)
  for (const l of linhas) {
    if (!l.existe_docs_pendentes) continue;
    try {
      const q = await page.evaluate(async (id) => {
        const r = await fetch(`/AtualizarColaborador/QuantidadeDocumentosPendentesAjax?idCompetencia=${id}`, { credentials: 'same-origin' });
        return r.json();
      }, l.id);
      l.quantidade_documentos_pendentes = q.quantidade_documentos_pendentes;
    } catch {
      l.quantidade_documentos_pendentes = null;
    }
  }
  return linhas.map((l) => ({
    chave: `${nome}:${l.id}`,
    tela: nome,
    id: l.id,
    contratante: l.contratante,
    competencia: l.competencia,
    contrato: l.contrato,
    contratada: l.contratada,
    area: l.area,
    cnpj: l.cnpj,
    status: l.status_descricao,
    docs_pendentes: !!l.existe_docs_pendentes,
    qtd_docs_pendentes: l.quantidade_documentos_pendentes ?? null,
  }));
}

// Relatório 012 (app.contractweb.com.br): lista TODOS os pedidos (paginando) e baixa o último "Concluido".
// Pedido novo do 012 (OK do usuário em 28/10): no máximo 1 SOLICITAR por dia, e só se não houver pedido de hoje na lista.
// A data do pedido fica gravada ANTES do clique, para uma falha no meio não virar vários pedidos no mesmo dia.
// SOLICITAR_012=0 desliga.
const SOLICITAR_012 = process.env.SOLICITAR_012 !== '0';
const MARCA_012 = path.join(OUT, 'relatorios', 'solicitado-012.json');
const hojeBR = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

async function lerPedidos012(rel) {
  const pedidos = [];
  const primeira = rel.locator('button:has(i.mdi-chevron-double-left)');
  if (await primeira.count()) await primeira.first().click().catch(() => {});
  for (let pag = 0; pag < 50; pag++) {
    const linhas = await rel.$$eval('table.q-table tbody tr', (trs) =>
      trs.map((tr) => {
        const c = Array.from(tr.cells).map((x) => x.innerText.trim().replace(/\s+/g, ' '));
        return { status: c[0], solicitado_em: c[1], contratante: c[2], grupo_area: c[3], unidade: c[4], tem_download: !!tr.querySelector('button i.material-icons') };
      })
    );
    pedidos.push(...linhas.map((l, i) => ({ ...l, _pagina: pag, _linha: i })));
    const prox = rel.locator('button:has(i.mdi-chevron-right)');
    if (!(await prox.count()) || (await prox.first().isDisabled())) break;
    await prox.first().click();
    await rel.waitForTimeout(500);
  }
  return pedidos;
}

// Pede o relatório com o mesmo filtro do pedido de 25/09 (só o contratante) e espera ele sair da fila (até ~10 min).
async function solicitar012(rel, pedidos) {
  const hoje = hojeBR();
  if (!SOLICITAR_012) return pedidos;
  if (pedidos.some((p) => (p.solicitado_em || '').startsWith(hoje))) return pedidos;
  let marca = {};
  try { marca = JSON.parse(fs.readFileSync(MARCA_012, 'utf8')); } catch {}
  if (marca.dia === hoje) return pedidos;
  fs.mkdirSync(path.dirname(MARCA_012), { recursive: true });
  gravar(MARCA_012, JSON.stringify({ dia: hoje, em: new Date().toISOString() }));
  try {
    const campo = rel.locator('.q-field', { hasText: 'Contratante' }).first();
    if (!/Equatorial/i.test(await campo.innerText().catch(() => ''))) {
      await campo.click();
      await rel.waitForTimeout(1500);
      await rel.locator('.q-menu .q-item', { hasText: 'Equatorial' }).first().click();
      await rel.waitForTimeout(800);
      await rel.keyboard.press('Escape').catch(() => {});
    }
    await rel.locator('button:visible', { hasText: /^\s*solicitar\s*$/i }).first().click();
    await rel.waitForTimeout(1500);
    const ok = rel.locator('.q-dialog button:visible', { hasText: /^\s*(ok|sim|confirmar)\s*$/i });
    if (await ok.count()) await ok.first().click().catch(() => {});
    log('Relatório 012: pedido novo feito (SOLICITAR).');
  } catch (e) {
    log(`Relatório 012: não consegui solicitar (${e.message.split('\n')[0]}); sigo com o último pronto.`);
    return pedidos;
  }
  for (let t = 0; t < 20; t++) {
    await rel.waitForTimeout(30000);
    const atualizar = rel.locator('button:visible', { hasText: /atualizar listagem/i });
    if (await atualizar.count()) await atualizar.first().click().catch(() => {});
    else await rel.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await rel.waitForTimeout(1500);
    await rel.waitForSelector('table.q-table tbody tr', { timeout: 30000 }).catch(() => {});
    const novos = await lerPedidos012(rel).catch(() => []);
    const deHoje = novos.find((p) => (p.solicitado_em || '').startsWith(hoje));
    if (deHoje && (deHoje.status === 'Concluido' || deHoje.status === 'Sem Conteúdo')) {
      log(`Relatório 012 de ${deHoje.solicitado_em}: ${deHoje.status}.`);
      return novos;
    }
  }
  log('Relatório 012: o pedido de hoje não ficou pronto em 10 min; sigo com o último pronto (ele é baixado na próxima leitura).');
  return lerPedidos012(rel).catch(() => pedidos);
}

// Lê a lista de pedidos do 012, pede um novo se precisar (solicitar012) e baixa o mais novo pronto.
async function lerRelatorio012(page, ctx) {
  await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  // Perfil novo abre com o menu lateral recolhido (só ícones, sem os textos): expande pelo botão do topo.
  if (!(await page.locator('span.nav-label:visible', { hasText: 'Relatórios' }).count())) {
    await page.locator('#bt-menu').click().catch(() => {});
    await page.waitForTimeout(800);
  }
  for (const nivel of ['Relatórios', 'Documentos e Análise']) {
    await page.evaluate((t) => Array.from(document.querySelectorAll('a')).find((x) => x.innerText.trim() === t)?.click(), nivel);
    await page.waitForTimeout(600);
  }
  const link = page.locator('a:visible', { hasText: '012 - Relatório de Documentos Pendentes' }).first();
  const [aba] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), link.click()]);
  const rel = aba || page;
  await rel.waitForSelector('table.q-table tbody tr', { timeout: 30000 });

  const pedidos = await solicitar012(rel, await lerPedidos012(rel));

  // Baixa o mais recente com status Concluido (primeira ocorrência: a lista vem do mais novo para o mais antigo)
  let arquivo = null;
  const alvo = pedidos.find((p) => p.status === 'Concluido' && p.tem_download);
  const prefixo = alvo ? alvo.solicitado_em.replace(/[/: ]/g, '-') : '';
  const pasta = path.join(OUT, 'relatorios');
  const jaBaixado = alvo && fs.existsSync(pasta) ? fs.readdirSync(pasta).find((f) => f.startsWith(prefixo + '_') && f.endsWith('.xlsx')) : null;
  if (jaBaixado) {
    arquivo = path.join(pasta, jaBaixado);
    log(`Relatório de ${alvo.solicitado_em} já baixado, reaproveitando.`);
  } else if (alvo) {
    try {
      const primeira = rel.locator('button:has(i.mdi-chevron-double-left)');
      if (await primeira.count()) await primeira.first().click().catch(() => {});
      for (let k = 0; k < alvo._pagina; k++) {
        await rel.locator('button:has(i.mdi-chevron-right)').first().click();
        await rel.waitForTimeout(400);
      }
      // O clique chama a API de download, que responde {"dados": "<URL assinada do arquivo>"}; depois o portal abre e
      // fecha uma aba sozinho, cancelando o download do navegador. Por isso pegamos a URL da resposta e baixamos direto.
      fs.mkdirSync(pasta, { recursive: true });
      const urlArquivo = new Promise((resolve, reject) => {
        rel.on('response', async (r) => {
          if (!/\/api\/v1\/Download\?/.test(r.url())) return;
          try {
            const j = JSON.parse(await r.text());
            j.dados ? resolve(j.dados) : reject(new Error('resposta de download sem URL'));
          } catch (e) {
            reject(e);
          }
        });
        setTimeout(() => reject(new Error('timeout aguardando a URL do download')), 60000);
      });
      urlArquivo.catch(() => {});
      await rel.locator('table.q-table tbody tr').nth(alvo._linha).locator('button:has(i.material-icons)').click();
      const resp = await fetch(await urlArquivo);
      if (!resp.ok) throw new Error(`download HTTP ${resp.status}`);
      const destino = path.join(pasta, `${prefixo}_Relatorio Documentos Pendentes.xlsx`);
      fs.writeFileSync(destino, Buffer.from(await resp.arrayBuffer()));
      arquivo = destino;
      log(`Relatório baixado: ${arquivo}`);
    } catch (e) {
      log(`Falha ao baixar o relatório: ${e.message.split('\n')[0]}`);
    }
  }
  if (aba) await aba.close().catch(() => {});
  return { total_pedidos: pedidos.length, pedidos: pedidos.map(({ _pagina, _linha, ...r }) => r), ultimo_baixado: arquivo };
}

// Lê o .xlsx do relatório 012 e devolve uma linha por documento.
// "Não Entregue" = falta enviar ao portal (é o que interessa ao robô de envio). "Não Analisado" = enviado, aguardando análise.
async function lerXlsx(arquivo) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(arquivo);
  const ws = wb.worksheets[0];
  const val = (c) => {
    const v = c.value;
    const t = v && typeof v === 'object' ? (v.result ?? v.text ?? '') : v;
    return t == null ? '' : String(t).trim();
  };
  let cab = 0;
  ws.eachRow((r, i) => { if (!cab && val(r.getCell(1)) === 'Contrato') cab = i; });
  if (!cab) throw new Error('Cabeçalho "Contrato" não encontrado no xlsx.');
  // Lê pelo nome da coluna: o relatório de 30/10 veio com 19 colunas (o de 25/09 tinha 16) e a posição mudou.
  const col = {};
  ws.getRow(cab).eachCell((c, n) => { col[val(c).replace(/\s+/g, ' ')] = n; });
  const faltando = ['Contrato', 'Contratada', 'Risco', 'Competência', 'Área', 'Descrição', 'Colaboradores', 'Status dos Documentos', 'Unidade', 'Tipo'].filter((n) => !col[n]);
  if (faltando.length) throw new Error(`Coluna não encontrada no xlsx: ${faltando.join(', ')}.`);
  const docs = [];
  ws.eachRow((r, i) => {
    if (i <= cab || !val(r.getCell(1))) return;
    const g = (nome) => (col[nome] ? val(r.getCell(col[nome])) : '');
    const d = {
      contrato: g('Contrato'), contratada: g('Contratada'), risco: g('Risco'), competencia: g('Competência'),
      area: g('Área'), descricao: g('Descrição'), colaboradores: [g('Colaboradores'), g('Colaboradores (Parte 2)')].filter(Boolean).join(' '),
      status: g('Status dos Documentos'), unidade: g('Unidade'), tipo: g('Tipo'),
    };
    d.chave = `doc:${[d.contrato, d.contratada, d.competencia, d.area, d.descricao, d.colaboradores, d.unidade].join('|')}`;
    d.docs_pendentes = d.status === 'Não Entregue';
    docs.push(d);
  });
  return docs;
}

function compararComAnterior(atual) {
  const arq = path.join(OUT, 'pendencias.json');
  let anterior = [];
  try {
    anterior = JSON.parse(fs.readFileSync(arq, 'utf8')).itens || [];
  } catch {}
  const mapa = (a) => new Map(a.map((i) => [i.chave, i]));
  const ant = mapa(anterior);
  const cur = mapa(atual);
  const novas = atual.filter((i) => !ant.has(i.chave));
  const resolvidas = anterior.filter((i) => !cur.has(i.chave));
  const alteradas = atual.filter((i) => {
    const a = ant.get(i.chave);
    return a && (a.status !== i.status || a.qtd_docs_pendentes !== i.qtd_docs_pendentes);
  });
  return { novas, resolvidas, alteradas };
}

const descr = (i) =>
  i.descricao
    ? `${i.contrato} | ${i.contratada} | ${i.area} | ${i.descricao}${i.colaboradores ? ' | ' + i.colaboradores : ''} | ${i.status}`
    : `${i.contratante} | ${i.contrato} | ${i.contratada} | ${i.area} | comp. ${i.competencia} | ${i.status}` +
  (i.qtd_docs_pendentes != null ? ` | ${i.qtd_docs_pendentes} doc(s) pendente(s)` : '');

async function ciclo(page) {
  await garantirLogin(page);
  let itens = [];
  for (const tela of TELAS) {
    const r = await lerTela(page, tela);
    log(`${tela.nome}: ${r.length} competência(s)`);
    itens = itens.concat(r);
  }
  let relatorio012 = null;
  try {
    relatorio012 = await lerRelatorio012(page, page.context());
    log(`Relatório 012: ${relatorio012.total_pedidos} pedido(s) listado(s)`);
  } catch (e) {
    log(`Relatório 012 falhou: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(OUT, 'falha-012.png') }).catch(() => {});
  }
  if (relatorio012?.ultimo_baixado) {
    try {
      const docs = await lerXlsx(relatorio012.ultimo_baixado);
      const cont = docs.reduce((a, d) => ((a[d.status] = (a[d.status] || 0) + 1), a), {});
      log(`Documentos no relatório: ${docs.length} ${JSON.stringify(cont)}`);
      relatorio012.documentos_por_status = cont;
      itens = itens.concat(docs);
    } catch (e) {
      log(`Falha ao ler o xlsx: ${e.message}`);
    }
  }
  if (!itens.some((i) => i.chave.startsWith('doc:'))) {
    // Sem leitura do xlsx neste ciclo: manter os documentos anteriores para não registrar "SAIU" falso.
    try {
      const antes = JSON.parse(fs.readFileSync(path.join(OUT, 'pendencias.json'), 'utf8')).itens || [];
      itens = itens.concat(antes.filter((i) => i.chave.startsWith('doc:')));
      log('Documentos mantidos da leitura anterior (xlsx indisponível agora).');
    } catch {}
  }
  const primeiraLeitura = !fs.existsSync(path.join(OUT, 'pendencias.json'));
  const { novas, resolvidas, alteradas } = compararComAnterior(itens);
  const agora = new Date().toISOString();
  const doc = { coletado_em: agora, incluiu_concluidos: CONCLUIDOS, total: itens.length, itens, relatorio012 };
  gravar(path.join(OUT, 'pendencias.json'), JSON.stringify(doc, null, 2));
  gravar(path.join(HIST, `${agora.replace(/[:.]/g, '-')}.json`), JSON.stringify(doc));

  const linhas = [`Coletado em ${agora}: ${itens.length} competência(s)`];
  const com = itens.filter((i) => i.docs_pendentes);
  linhas.push(`Pendentes (competências com pendência + documentos "Não Entregue"): ${com.length}`);
  com.forEach((i) => linhas.push(`  PENDENTE  ${descr(i)}`));
  novas.forEach((i) => linhas.push(`  NOVA      ${descr(i)}`));
  resolvidas.forEach((i) => linhas.push(`  SAIU      ${descr(i)}`));
  alteradas.forEach((i) => linhas.push(`  ALTERADA  ${descr(i)}`));
  const resumo = linhas.join('\n');
  fs.appendFileSync(path.join(OUT, 'mudancas.txt'), resumo + '\n\n', 'utf8');
  console.log(resumo);

  // Alerta quando o portal passa a exigir um documento (novo "Não Entregue"/pendência) ou quando um sai da lista.
  // Sem ALERT_WEBHOOK_URL só registra no log. Na primeira leitura manda um resumo do que já estava pendente.
  const exigidos = (primeiraLeitura ? com : [...novas, ...alteradas].filter((i) => i.docs_pendentes)).filter((i, k, a) => a.indexOf(i) === k);
  if (exigidos.length || (!primeiraLeitura && resolvidas.length)) {
    const lista = (arr) => arr.slice(0, 15).map((i) => '• ' + descr(i)).join('\n') + (arr.length > 15 ? `\n...  e mais ${arr.length - 15}` : '');
    const partes = [];
    if (exigidos.length) partes.push(`${primeiraLeitura ? 'Documentos pendentes no Bernhoeft' : 'Bernhoeft passou a exigir'} (${exigidos.length}):\n${lista(exigidos)}`);
    if (!primeiraLeitura && resolvidas.length) partes.push(`Saíram da lista de pendências (${resolvidas.length}):\n${lista(resolvidas)}`);
    await avisar(partes.join('\n\n'), { tipo: 'documentos_requeridos', exigidos, resolvidas: primeiraLeitura ? [] : resolvidas, coletado_em: agora });
  }
}

// Roda login_auto.py (sem navegador do Node aberto, para não travar o profile). true = logou.
// Auditoria do CAPTCHA (29/10): a saída do login_auto.py (método, tentativa, resultado e tempo; nunca senha nem token) vai também
// para out/login-captcha.log, que não é apagado como o log do container.
const LOG_CAPTCHA = path.join(OUT, 'login-captcha.log');
function loginAutomatico() {
  log('Sessão expirada. Tentando login automático (reCAPTCHA por áudio)...');
  const r = spawnSync(PYTHON_BIN, [path.join(__dirname, 'login_auto.py')], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env });
  const saida = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(saida);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(LOG_CAPTCHA, `=== ${new Date().toISOString()} login automático (saída ${r.status})\n${saida.replace(/\r/g, '')}`, 'utf8');
  } catch {}
  return r.status === 0;
}

const abrir = async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 50,
    locale: 'en-US', // o desafio de áudio do reCAPTCHA só traz o link do MP3 em inglês (ver login_auto.py)
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    viewport: { width: 1366, height: 850 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  return { ctx, page };
};

(async () => {
  fs.mkdirSync(HIST, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  let { ctx, page } = await abrir();
  try {
    do {
      try {
        try {
          await ciclo(page);
        } catch (e) {
          if (!e.precisaLogin) throw e;
          await ctx.close().catch(() => {});
          const ok = loginAutomatico();
          ({ ctx, page } = await abrir());
          if (ok) {
            await ciclo(page);
          } else if (HEADLESS) {
            await avisar('Bernhoeft: sessão expirada e o login automático falhou. Faça login manual (node login.js).');
            const f = new Error('Sessão expirada (login automático falhou).');
            f.codigo = 2;
            throw f;
          } else {
            // Com janela: cai no login manual (a pessoa marca o reCAPTCHA).
            await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
            await preencherLogin(page);
            log('Login automático falhou. Marque o reCAPTCHA e clique em Login na janela (até 15 min).');
            await page.waitForSelector('#password', { state: 'detached', timeout: 900000 });
            await ciclo(page);
          }
        }
      } catch (e) {
        console.error('ERRO no ciclo:', e.message);
        if (e.codigo) process.exitCode = e.codigo;
        if (!LOOP) throw e;
      }
      if (LOOP) {
        log(`Próxima leitura em ${INTERVALO_MIN} min (Ctrl+C para parar).`);
        // O painel pede leitura imediata criando out/rodar-agora (botão "Reiniciar").
        const SINAL = path.join(OUT, 'rodar-agora');
        for (let t = 0; t < INTERVALO_MIN * 12 && !fs.existsSync(SINAL); t++) {
          await dormir(5000);
          // Pedidos da aba 7 do painel (verificar/enviar documento de empresa), com esta mesma sessão. Ver entregar.js.
          // Depois, o envio automático (só com "Envio liberado" + "Automático" ligados no painel; sem fila, sai na hora).
          try {
            if (entrega.temPedidos()) await entrega.processarPedidos(page);
            await entrega.automatico(page);
          } catch (e) {
            // Sessão caiu: a leitura refaz o login e o pedido continua na fila.
            if (e.precisaLogin) { fs.writeFileSync(SINAL, ''); break; }
            console.error('ERRO nos pedidos do painel:', e.message.split('\n')[0]);
          }
        }
        if (fs.existsSync(SINAL)) { fs.rmSync(SINAL, { force: true }); log('Leitura pedida pelo painel: lendo agora.'); }
      }
    } while (LOOP);
  } catch {
    process.exitCode = process.exitCode || 1;
  } finally {
    await ctx.close().catch(() => {});
  }
})();
