// Entrega dos documentos de EMPRESA ao Bernhoeft (ContractWeb), pela mesma tela que uma pessoa usa (mapeada em 26/10, só leitura):
//   Carregamento Mobilização → competência "Documentos da empresa" do contrato → Etapa 6 → nuvem do documento
//   → (aviso de critérios, se houver) → modal: "Próximo" → arquivo → "Enviar para análise" → o botão vira "Fechar".
// O PDF vem da esteira do painel (auto.js): PACOTES/auto/estado.json, item.pdf = auto/<pasta>/pacote.pdf.
//
// TRAVA: só envia com o interruptor "Envio liberado" da aba 7 do painel LIGADO (out/envio/modo.json liberado: true;
// sem o arquivo = BLOQUEADO). Começa desligado; quem liga é o usuário. É relido logo antes de clicar em "Enviar para análise".
// Também não envia se: a última verificação não achou o mesmo documento (IdObjetoAnalise = --confirmo), o documento já tem
// arquivo no portal, o portal pede dados extras (data de emissão), aparece termo de reaproveitamento ou o PDF não é PDF.
// Não clica em "Próximo →" nem em "Concluir carregamento" da competência.
//
// Pedidos do painel: out/envio/pedidos/*.json { acao: 'verificar' | 'enviar', chave, confirmo }. O pendencias.js --loop atende
// entre as leituras, com a mesma sessão (o perfil do Chrome só abre num processo por vez), e roda o automático() se o
// interruptor "Modo de envio" estiver em Automático (ver automatico() no fim; começa desligado, quem liga é o usuário).
// Resultado de cada pendência: out/envio/resultados.json (por chave). Histórico: out/envios.log.
// Uso direto (só com o laço parado, senão o perfil está em uso):
//   node entregar.js --verificar "<chave>"
//   node entregar.js --enviar "<chave>" --confirmo <IdObjetoAnalise>
//   node entregar.js --ensaio "<chave>" --confirmo <id>   vai até "Enviar para análise" e fecha SEM clicar (teste)
//   node entregar.js --pedidos            atende a fila do painel e sai
const fs = require('fs');
const path = require('path');

const BASE = process.env.BERNHOEFT_URL || 'https://newcontract.contractweb.com.br';
const OUT = path.join(__dirname, 'out');
const DIR_ENVIO = path.join(OUT, 'envio');
const PEDIDOS = path.join(DIR_ENVIO, 'pedidos');
const PACOTES = process.env.PACOTES || path.join(__dirname, 'deploy', 'gesdoc', 'services', 'painel', 'pacotes');
const MAX_MB = Number(process.env.ENTREGA_MAX_MB || 40);
const log = (m) => console.log(`[${new Date().toLocaleTimeString('pt-BR')}] ${m}`);

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const lerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// O robô roda como root no container e o painel (1000) precisa gravar pedidos e ler resultados: toda pasta criada aqui
// fica com o dono da pasta out/ (mkdirSync recursive criaria todas como root).
function pasta(dir) {
  if (fs.existsSync(dir)) return;
  pasta(path.dirname(dir));
  fs.mkdirSync(dir);
  try { const s = fs.statSync(OUT); if (process.getuid?.() === 0 && s.uid !== 0) fs.chownSync(dir, s.uid, s.gid); } catch {}
}
function gravar(arq, obj) {
  pasta(path.dirname(arq));
  const tmp = arq + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, arq);
  try { const s = fs.statSync(OUT); if (process.getuid?.() === 0 && s.uid !== 0) fs.chownSync(arq, s.uid, s.gid); } catch {}
}
// modo.json { liberado, automatico, confianca }: automático só vale com liberado; confianca = a menor que sai sozinha (padrão alta).
const NIVEL = { alta: 3, media: 2, baixa: 1 };
const nivel = (c) => NIVEL[normalizar(c)] || 0;
function lerModo() {
  const m = lerJson(path.join(DIR_ENVIO, 'modo.json')) || {};
  const lib = m.liberado === true;
  return { liberado: lib, automatico: lib && m.automatico === true, confianca: NIVEL[m.confianca] ? m.confianca : 'alta' };
}
const liberado = () => lerModo().liberado;
const BLOQUEADO = 'envio bloqueado no painel (interruptor "Envio liberado" da aba 7 desligado): nada foi enviado';
function registro(m) {
  log(m);
  pasta(OUT);
  fs.appendFileSync(path.join(OUT, 'envios.log'), `[${new Date().toISOString()}] ${m}\n`, 'utf8');
}
function resultado(chave, r) {
  const arq = path.join(DIR_ENVIO, 'resultados.json');
  const todos = lerJson(arq) || {};
  todos[chave] = { ...r, em: new Date().toISOString() };
  gravar(arq, todos);
}

// Item da esteira (painel/auto.js) pela chave da pendência ("doc:contrato|contratada|competência|área|descrição|…").
function itemDaEsteira(chave) {
  const e = lerJson(path.join(PACOTES, 'auto', 'estado.json'));
  if (!e) throw new Error(`a esteira ainda não rodou (sem ${path.join(PACOTES, 'auto', 'estado.json')})`);
  const it = (e.itens || []).find((i) => i.pendencia?.chave === chave);
  if (!it) throw new Error('a pendência não está na lista da esteira (rode "Buscar na Factorial" no painel)');
  return it;
}
function conferirPdf(item) {
  if (item.por_colaborador) return { erro: 'documento de colaborador: um PDF por colaborador, entra pela Mobilização (este envio é só da Etapa 6, documento de empresa)' };
  if (item.estado !== 'pronto' || !item.pdf) return { erro: 'a esteira não montou o PDF desta pendência' };
  const arq = path.join(PACOTES, item.pdf);
  let st;
  try { st = fs.statSync(arq); } catch { return { erro: 'o PDF montado não está mais na pasta de pacotes' }; }
  if (!st.size) return { erro: 'o PDF montado está vazio' };
  if (st.size > MAX_MB * 1024 * 1024) return { erro: `o PDF tem ${Math.round(st.size / 1048576)} MB (limite ${MAX_MB} MB)` };
  const fd = fs.openSync(arq, 'r'); const cab = Buffer.alloc(5); fs.readSync(fd, cab, 0, 5, 0); fs.closeSync(fd);
  if (cab.toString() !== '%PDF-') return { erro: 'o arquivo montado não é um PDF' };
  return { arq, kb: Math.round(st.size / 1024) };
}

function precisaLogin() { const e = new Error('Sessão do Bernhoeft expirada'); e.precisaLogin = true; return e; }
async function semSessao(page) { return !!(await page.$('#password')); }

// Competência "Documentos da empresa" do contrato (uma por contrato/área). A lista do portal só devolve algo com a busca.
let urlLista = null;
async function competenciaEmpresa(page, p) {
  if (!urlLista) {
    const ouvir = (r) => { if (r.url().includes('/AtualizarColaborador/ListarCompetenciasAjax') && !urlLista) urlLista = r.url(); };
    page.on('response', ouvir);
    await page.goto(`${BASE}/AtualizarColaborador?TipoCompetencia=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    page.off('response', ouvir);
    if (await semSessao(page)) throw precisaLogin();
    if (!urlLista) throw new Error('não consegui ler a lista de competências de Mobilização');
  }
  const numero = String(p.contrato).split(' - ')[0].trim();
  const achadas = [];
  for (const concl of [false, true]) {
    const u = new URL(urlLista, BASE);
    u.searchParams.set('start', '0'); u.searchParams.set('length', '100'); u.searchParams.set('search', numero);
    if (concl) u.searchParams.set('concluido', 'on'); else u.searchParams.delete('concluido');
    const j = await page.evaluate(async (url) => (await fetch(url, { credentials: 'same-origin' })).json(), u.toString());
    achadas.push(...(j.data || []));
  }
  const unicas = [...new Map(achadas.map((c) => [c.id, c])).values()]
    .filter((c) => /documentos da empresa/i.test(c.competencia || '') && normalizar(c.contrato) === normalizar(p.contrato));
  const mesmaArea = unicas.filter((c) => !p.area || normalizar(c.area) === normalizar(p.area));
  const lista = mesmaArea.length ? mesmaArea : unicas;
  if (!lista.length) throw new Error(`o contrato ${p.contrato} não tem competência "Documentos da empresa" na Mobilização`);
  if (lista.length > 1) throw new Error(`o contrato ${p.contrato} tem ${lista.length} competências "Documentos da empresa" (${lista.map((c) => c.id).join(', ')}): não dá para saber qual`);
  return { id: lista[0].id, status: lista[0].status_descricao, area: lista[0].area };
}

// Lê a Etapa 6 e acha o documento pelo título exato (sem acento/caixa). Só leitura.
async function documentoNaEtapa6(page, compId, descricao) {
  await page.goto(`${BASE}/AtualizarColaborador/Etapa6/${compId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (await semSessao(page)) throw precisaLogin();
  await page.waitForSelector('a.nav-container[data-parent="#stacked-menu"]', { timeout: 20000 }).catch(() => {});
  const paineis = await page.$$eval('div.doc-tab[id^="panel-"]', (els) => els.map((el) => {
    const titulo = el.querySelector('a.nav-container')?.textContent.trim() || '';
    const nuvem = el.querySelector('span[title="carregar arquivo"]');
    const onclick = nuvem?.getAttribute('onclick') || '';
    const obj = /"IdObjetoAnalise"\s*:\s*(\d+)/.exec(onclick);
    const exig = /"FlagPossuiExigenciaCarregamento"\s*:\s*(\d+)/.exec(onclick);
    const linhas = [...el.querySelectorAll('tr[id^="solicitacaodoc-"]')].map((tr) => ({
      arquivo: tr.querySelector('a[id^="download-"]')?.textContent.trim() || '',
      data: tr.querySelector('label[id^="data-"]')?.textContent.trim() || '',
      status: [...tr.querySelectorAll('td span')].map((s) => s.textContent.trim()).filter(Boolean).pop() || '',
    }));
    const info = el.querySelector('span[title="Informações"]')?.getAttribute('data-value') || '';
    return { painel: el.id, titulo, tem_nuvem: !!nuvem, objeto_id: obj ? Number(obj[1]) : null, exige_dados: exig ? exig[1] === '1' : null, arquivos: linhas, criterio: info };
  }));
  const alvo = paineis.filter((x) => normalizar(x.titulo) === normalizar(descricao));
  if (!alvo.length) throw new Error(`o documento "${descricao}" não aparece na Etapa 6 da competência ${compId}`);
  if (alvo.length > 1) throw new Error(`o documento "${descricao}" aparece ${alvo.length} vezes na Etapa 6 da competência ${compId}`);
  return alvo[0];
}

// Verificar: não grava nada no portal. pronta = pode enviar com --confirmo <objeto_id>.
async function verificar(page, chave) {
  const item = itemDaEsteira(chave);
  const p = item.pendencia;
  const motivos = [];
  const pdf = conferirPdf(item);
  if (pdf.erro) motivos.push(pdf.erro);
  const comp = await competenciaEmpresa(page, p);
  const doc = await documentoNaEtapa6(page, comp.id, p.descricao);
  if (!doc.tem_nuvem || !doc.objeto_id) motivos.push('o portal não mostra o botão de carregar arquivo neste documento');
  if (doc.arquivos.length) motivos.push(`o documento já tem ${doc.arquivos.length} arquivo(s) no portal (último: ${doc.arquivos[0].status || 'sem status'}, ${doc.arquivos[0].data}): enviar de novo só à mão`);
  if (doc.exige_dados) motivos.push('o portal pede dados extras neste documento (data de emissão): enviar à mão');
  return {
    pronta: !motivos.length, motivos, contrato: p.contrato, documento: p.descricao, competencia_id: comp.id, competencia_status: comp.status,
    objeto_id: doc.objeto_id, painel: doc.painel, criterio: doc.criterio || null, arquivos_no_portal: doc.arquivos.length,
    pdf: item.pdf || null, kb: pdf.kb ?? null, confianca: item.confianca || null,
  };
}

// Envia UM documento. Para antes de clicar em "Enviar para análise" se qualquer conferência falhar.
// ensaio: faz tudo até o "Enviar para análise" ficar disponível e fecha o modal SEM clicar (teste dos seletores; só pela linha de comando).
async function enviar(page, chave, confirmo, { ensaio = false } = {}) {
  if (!ensaio && !liberado()) throw new Error(BLOQUEADO);
  const v = await verificar(page, chave);
  if (!v.pronta) throw new Error('NÃO ENVIEI: ' + v.motivos.join('; '));
  if (String(v.objeto_id) !== String(confirmo)) throw new Error(`NÃO ENVIEI: o documento no portal mudou (objeto ${v.objeto_id}, a verificação viu ${confirmo}): verifique de novo`);
  const { arq } = conferirPdf(itemDaEsteira(chave));
  const painel = page.locator(`#${v.painel}`);
  await painel.locator('span[title="carregar arquivo"]').first().click();
  // Critérios/particularidades do documento: o botão do aviso leva ao modal de upload.
  const part = page.locator('#modalParticularidadeDoObjetoCarregamento');
  if (await part.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
    if (!/carregar arquivo/i.test(await page.locator('#btnParticularidadeDoObjetoCarregamento').innerText())) throw new Error('NÃO ENVIEI: o portal pede dados extras antes do arquivo');
    await page.locator('#btnParticularidadeDoObjetoCarregamento').click();
  }
  if (await page.locator('#modalPreenchimentoFornecedor').isVisible().catch(() => false)) throw new Error('NÃO ENVIEI: o portal pede dados extras (data de emissão)');
  const m = page.locator('#modalStepsDocumentUpload');
  await m.waitFor({ state: 'visible', timeout: 15000 });
  const next = m.locator('#msu-next');
  if (/pr[oó]ximo/i.test(await next.innerText())) await next.click();
  await m.locator('#msu-file').setInputFiles(arq);
  await page.waitForFunction(() => {
    const b = document.querySelector('#modalStepsDocumentUpload #msu-next');
    return b && !b.disabled && /enviar para an/i.test(b.textContent);
  }, null, { timeout: 20000 }).catch(() => { throw new Error('NÃO ENVIEI: o portal não liberou "Enviar para análise" com o arquivo'); });
  if (await m.locator('#msu-reuse-ack-wrapper:not(.d-none)').count()) throw new Error('NÃO ENVIEI: o portal pede para aceitar o termo de reaproveitamento de documento');
  if (await m.locator('#msu-file-error:not(.d-none)').count()) throw new Error('NÃO ENVIEI: o portal recusou o arquivo: ' + (await m.locator('#msu-file-error').innerText()).trim());
  if (ensaio) {
    const botao = (await next.innerText()).trim();
    await page.evaluate(() => window.jQuery && jQuery('#modalStepsDocumentUpload').modal('hide'));
    return { ...v, ensaio: true, botao_final: botao, msg: `ENSAIO: chegou até "${botao}" com o arquivo e fechou sem clicar (nada enviado)` };
  }
  // Última trava: o interruptor pode ter sido desligado enquanto o robô abria a tela.
  if (!liberado()) throw new Error(BLOQUEADO);
  registro(`ENVIANDO ${v.contrato} · "${v.documento}" (competência ${v.competencia_id}, objeto ${v.objeto_id}, ${v.kb} KB)`);
  await next.click();
  // Daqui em diante o portal pode ter recebido o arquivo: erro leva clicou = true (o automático não tenta de novo).
  try {
    const fim = await page.waitForFunction(() => {
      const m = document.querySelector('#modalStepsDocumentUpload');
      const b = m?.querySelector('#msu-next');
      const erro = m?.querySelector('#msu-file-error:not(.d-none)');
      if (erro && erro.textContent.trim()) return 'erro:' + erro.textContent.trim();
      return b && /fechar/i.test(b.textContent) ? 'ok' : false;
    }, null, { timeout: 180000 }).then((h) => h.jsonValue()).catch(() => 'erro:o portal não confirmou em 3 min');
    if (fim !== 'ok') throw new Error(`o portal não confirmou o envio (${fim.replace(/^erro:/, '')}): conferir na Etapa 6 antes de tentar de novo`);
    await next.click().catch(() => {});
    // Confere relendo a tela: o arquivo tem que aparecer no documento.
    const depois = await documentoNaEtapa6(page, v.competencia_id, v.documento);
    if (!depois.arquivos.length) throw new Error('o portal disse que recebeu, mas o arquivo não aparece na Etapa 6: conferir à mão');
    return { ...v, status_portal: depois.arquivos[0].status || null, arquivo_portal: depois.arquivos[0].arquivo || null };
  } catch (e) { e.clicou = true; throw e; }
}

// Fila do painel. Enviar: o pedido sai da fila ANTES de enviar (se o robô cair no meio, não envia de novo sozinho).
async function processarPedidos(page) {
  let arqs;
  try { arqs = fs.readdirSync(PEDIDOS).filter((f) => f.endsWith('.json')).sort(); } catch { return 0; }
  let feitos = 0;
  for (const f of arqs) {
    const caminho = path.join(PEDIDOS, f);
    const ped = lerJson(caminho);
    if (!ped || !['verificar', 'enviar'].includes(ped.acao) || !ped.chave) { fs.rmSync(caminho, { force: true }); continue; }
    try {
      if (ped.acao === 'verificar') {
        const v = await verificar(page, ped.chave);
        fs.rmSync(caminho, { force: true });
        resultado(ped.chave, { acao: 'verificar', ok: v.pronta, ...v, msg: v.pronta ? `pode enviar: competência ${v.competencia_id}, documento sem arquivo no portal` : v.motivos.join('; ') });
        log(`Verificado ${v.contrato} · ${v.documento}: ${v.pronta ? 'pode enviar' : v.motivos.join('; ')}`);
      } else {
        fs.rmSync(caminho, { force: true });
        const r = await enviar(page, ped.chave, ped.confirmo);
        resultado(ped.chave, { acao: 'enviar', ok: true, ...r, msg: `ENVIADO para análise; no portal agora: ${r.status_portal || 'sem status'}` });
        registro(`ENVIADO ${r.contrato} · "${r.documento}" → ${r.status_portal || 'sem status'}`);
      }
    } catch (e) {
      if (e.precisaLogin && !e.clicou) { log('Pedido do painel esperando: a sessão caiu (o login é refeito na próxima leitura).'); throw e; }
      fs.rmSync(caminho, { force: true });
      const msg = e.message.split('\n')[0];
      resultado(ped.chave, { acao: ped.acao, ok: false, clicou: Boolean(e.clicou), msg });
      if (ped.acao === 'enviar') registro(`NÃO ENVIADO (${ped.chave.slice(0, 80)}): ${msg}`);
      else log(`Verificação falhou: ${msg}`);
      if (e.precisaLogin) throw e;
    }
    feitos++;
  }
  return feitos;
}
const temPedidos = () => { try { return fs.readdirSync(PEDIDOS).some((f) => f.endsWith('.json')); } catch { return false; } };

// Envio AUTOMÁTICO (aba 7, interruptor "Modo de envio"; só com "Envio liberado" ligado). Roda depois que a esteira terminou
// de montar os PDFs da última leitura do portal. Sai sozinho só o que: está pronto, tem a confiança mínima escolhida no painel,
// não está segurado (segurar.json) e nunca foi enviado. Cada um passa pela mesma verificação do botão e pelo mesmo enviar().
// Cada pendência é tentada no máximo uma vez por leitura (out/envio/auto.json). A que der erro é PULADA e as outras seguem
// (regra do usuário, 26/10: um arquivo com problema não para a automação); só para se o envio for bloqueado no painel.
// O que pode ter chegado ao portal (clicou) não sai mais sozinho: só à mão, depois de conferir na Etapa 6.
const ARQ_AUTO = path.join(DIR_ENVIO, 'auto.json');
function filaAutomatica() {
  const modo = lerModo();
  if (!modo.automatico) return null;
  const leitura = (lerJson(path.join(OUT, 'pendencias.json')) || {}).coletado_em;
  const e = lerJson(path.join(PACOTES, 'auto', 'estado.json'));
  if (!leitura || !e || !e.fim || e.erro || e.coletado_em !== leitura) return null;
  const a = lerJson(ARQ_AUTO) || {};
  const tentados = a.coletado_em === leitura ? a.tentados || {} : {};
  const res = lerJson(path.join(DIR_ENVIO, 'resultados.json')) || {};
  const seg = lerJson(path.join(DIR_ENVIO, 'segurar.json')) || {};
  const itens = (e.itens || []).filter((i) => {
    const ch = i.pendencia?.chave, r = res[ch];
    return ch && i.estado === 'pronto' && i.pdf && nivel(i.confianca) >= nivel(modo.confianca) && !seg[ch] && !tentados[ch]
      && !(r?.acao === 'enviar' && (r.ok || r.clicou));
  });
  return { leitura, tentados, itens };
}
// fn: só para o teste trocar verificar/enviar por versões falsas.
async function automatico(page, fn = { verificar, enviar }) {
  const f = filaAutomatica();
  if (!f || !f.itens.length) return 0;
  log(`Envio automático: ${f.itens.length} pendência(s) para conferir e enviar (leitura ${f.leitura}).`);
  let n = 0;
  for (const it of f.itens) {
    if (!lerModo().automatico) { log('Envio automático desligado no painel: parei.'); break; }
    const chave = it.pendencia.chave;
    f.tentados[chave] = new Date().toISOString();
    gravar(ARQ_AUTO, { coletado_em: f.leitura, tentados: f.tentados });
    let v = null;
    try {
      v = await fn.verificar(page, chave);
      if (!v.pronta) {
        resultado(chave, { acao: 'verificar', ok: false, auto: true, ...v, msg: 'o automático não enviou: ' + v.motivos.join('; ') });
        log(`Automático pulou ${v.contrato} · ${v.documento}: ${v.motivos.join('; ')}`);
        continue;
      }
      registro(`AUTOMÁTICO: ${v.contrato} · "${v.documento}" (confiança ${v.confianca || '?'})`);
      const r = await fn.enviar(page, chave, v.objeto_id);
      resultado(chave, { acao: 'enviar', ok: true, auto: true, ...r, msg: `ENVIADO pelo automático; no portal agora: ${r.status_portal || 'sem status'}` });
      registro(`ENVIADO (automático) ${r.contrato} · "${r.documento}" → ${r.status_portal || 'sem status'}`);
      n++;
    } catch (e) {
      const msg = e.message.split('\n')[0];
      if (e.precisaLogin && !e.clicou) {
        // Sessão caiu antes de subir: tenta de novo depois do login.
        delete f.tentados[chave];
        gravar(ARQ_AUTO, { coletado_em: f.leitura, tentados: f.tentados });
        throw e;
      }
      if (!v) {
        resultado(chave, { acao: 'verificar', ok: false, auto: true, msg: 'automático: ' + msg });
        log(`Automático: verificação falhou (${chave.slice(0, 80)}): ${msg}`);
        continue;
      }
      resultado(chave, { acao: 'enviar', ok: false, auto: true, clicou: Boolean(e.clicou), msg: 'automático: ' + msg });
      if (msg === BLOQUEADO) { registro(`AUTOMÁTICO PAROU: ${msg}`); break; }
      registro(`AUTOMÁTICO PULOU (${chave.slice(0, 80)}) e seguiu: ${msg}`);
      if (e.precisaLogin) throw e;
    }
  }
  return n;
}

module.exports = { verificar, enviar, processarPedidos, temPedidos, automatico, filaAutomatica, liberado };

if (require.main === module) {
  const { chromium } = require('playwright');
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
  (async () => {
    const ctx = await chromium.launchPersistentContext(process.env.PROFILE_DIR || path.join(__dirname, 'profile'), {
      executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined),
      headless: process.env.HEADLESS !== '0', locale: 'en-US', args: process.platform === 'linux' ? ['--no-sandbox'] : [], viewport: { width: 1366, height: 850 },
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.setDefaultTimeout(30000);
    try {
      if (arg('--verificar')) console.log(JSON.stringify(await verificar(page, arg('--verificar')), null, 2));
      else if (arg('--enviar')) console.log(JSON.stringify(await enviar(page, arg('--enviar'), arg('--confirmo')), null, 2));
      else if (arg('--ensaio')) console.log(JSON.stringify(await enviar(page, arg('--ensaio'), arg('--confirmo'), { ensaio: true }), null, 2));
      else if (process.argv.includes('--pedidos')) log(`${await processarPedidos(page)} pedido(s) atendido(s).`);
      else console.log('Uso: node entregar.js --verificar "<chave>" | --enviar "<chave>" --confirmo <id> | --pedidos');
    } catch (e) {
      console.error('ERRO:', e.message.split('\n')[0]);
      process.exitCode = e.precisaLogin ? 2 : 1;
    } finally {
      await ctx.close().catch(() => {});
    }
  })();
}
