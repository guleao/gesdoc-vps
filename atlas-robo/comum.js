// Partes comuns do robô Atlas (AFM Gestão, https://gestao.atlasfacilities.com.br). SOMENTE LEITURA.
// O portal é um app Angular que faz login por OIDC em accounts.atlasfacilities.com.br e chama a API em
// gateway.atlasfacilities.com.br com um token Bearer. O robô loga pela tela, captura esse token e lê a API.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP = process.env.ATLAS_URL || 'https://gestao.atlasfacilities.com.br';
const GATEWAY = 'https://gateway.atlasfacilities.com.br/api/v1/';
const OUT = path.join(__dirname, 'out');
const PROFILE = process.env.PROFILE_DIR || path.join(__dirname, 'profile');
// CHROME_PATH vazio => Chromium do Playwright (servidor). No Windows, usa o Chrome instalado.
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
// HEADLESS=1 (servidor): sem janela. Se o login falhar, avisa e sai com código 2.
const HEADLESS = process.env.HEADLESS === '1';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function abrir() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: HEADLESS,
    locale: 'pt-BR',
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    viewport: { width: 1366, height: 850 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  // Guarda o último token Bearer que o app usa com o gateway.
  ctx.token = null;
  ctx.on('request', (r) => {
    if (!r.url().startsWith('https://gateway.atlasfacilities.com.br/')) return;
    const a = r.headers()['authorization'];
    if (a && a.startsWith('Bearer ')) ctx.token = a.slice(7);
  });
  return { ctx, page };
}

const naTelaDeLogin = (page) => page.url().startsWith('https://accounts.atlasfacilities.com.br/');

// Espera o app decidir: ou fica no gestao (logado) ou redireciona para a tela de login.
// Os .catch cobrem consultas feitas no meio de um redirecionamento ("Execution context was destroyed").
async function esperarApp(page, limite = 45000) {
  const fim = Date.now() + limite;
  do {
    if (naTelaDeLogin(page) && (await page.getByText('Verifique seu e-mail').count().catch(() => 0))) return 'codigo';
    if (naTelaDeLogin(page) && (await page.$('#Username:visible').catch(() => null))) return 'login';
    const u = page.url();
    if (u.startsWith(APP) && !/\/sign-in|\/403|\/404/.test(u) && (await page.$('afm-sidebar, afm-navbar').catch(() => null))) return 'logado';
    await dormir(500);
  } while (Date.now() < fim);
  return 'indefinido';
}

const captchaVisivel = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('iframe[src*="recaptcha"]')).some((f) => {
      const r = f.getBoundingClientRect();
      return r.width > 30 && r.height > 30 && getComputedStyle(f).visibility !== 'hidden';
    })
  ).catch(() => false);

// Garante sessão: se cair na tela de login, preenche ATLAS_USER/ATLAS_PASSWORD e entra.
// Se aparecer reCAPTCHA visível: com janela, espera a pessoa resolver; headless, sai com código 2.
async function garantirLogin(page, rota = '/dashboard') {
  await page.goto(APP + rota, { waitUntil: 'domcontentloaded' });
  let estado = await esperarApp(page);
  if (estado === 'logado') return;
  if (estado !== 'login') throw new Error(`Não reconheci a tela após abrir o portal (${page.url()}).`);

  const user = process.env.ATLAS_USER;
  const senha = process.env.ATLAS_PASSWORD;
  if (!user || !senha) {
    const e = new Error('ATLAS_USER/ATLAS_PASSWORD não definidos.');
    e.codigo = 2;
    throw e;
  }
  log('Sessão fora. Fazendo login...');
  await page.fill('#Username', user);
  await page.fill('#Password', senha);
  if (await captchaVisivel(page)) await esperarCaptcha(page);
  await page.click('form button[name="button"]');
  estado = await esperarApp(page);
  if (estado === 'login' && (await captchaVisivel(page))) {
    await page.fill('#Password', senha).catch(() => {});
    await esperarCaptcha(page);
    await page.click('form button[name="button"]');
    estado = await esperarApp(page);
  }
  if (estado === 'codigo') {
    await informarCodigo(page);
    estado = await esperarApp(page);
  }
  if (estado !== 'logado') {
    const msg = naTelaDeLogin(page)
      ? await page.evaluate(() => Array.from(document.querySelectorAll('.validation-summary-errors, .text-danger, .alert, [class*="error"]')).map((e) => e.innerText.trim()).filter(Boolean).join(' | '))
      : '';
    await page.screenshot({ path: path.join(OUT, 'falha-login.png') }).catch(() => {});
    const e = new Error(`Login não concluído${msg ? ': ' + msg : ''} (tela salva em out/falha-login.png).`);
    e.codigo = 2;
    throw e;
  }
  log('Login feito.');
}

// Verificação em duas etapas: o Atlas manda um código de 8 caracteres (letras e números) para o e-mail do usuário.
// O robô espera o código no arquivo out/codigo.txt (ou, com janela, que a pessoa digite na tela) até CODIGO_MIN minutos.
const ARQ_CODIGO = path.join(OUT, 'codigo.txt');
async function informarCodigo(page) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'tela-codigo.html'), await page.content(), 'utf8');
  const limite = Number(process.env.CODIGO_MIN || 15) * 60000;
  const fim = Date.now() + limite;
  log(`O Atlas enviou um código por e-mail. Grave-o em ${ARQ_CODIGO}${HEADLESS ? '' : ' ou digite na janela'} (até ${limite / 60000} min).`);
  while (Date.now() < fim) {
    if ((await esperarApp(page, 1)) !== 'codigo') return; // a pessoa digitou na janela
    let codigo = '';
    try {
      // O código tem 8 caracteres com letras e números (ex.: d4270a19), apesar de a tela falar em "dígitos".
      codigo = fs.readFileSync(ARQ_CODIGO, 'utf8').replace(/[^0-9a-z]/gi, '');
    } catch {}
    if (codigo && codigo.length !== 8) {
      fs.rmSync(ARQ_CODIGO, { force: true });
      log(`Código com ${codigo.length} caractere(s) ignorado; o Atlas usa 8. Grave de novo em ${ARQ_CODIGO}.`);
      codigo = '';
    }
    if (codigo) {
      fs.rmSync(ARQ_CODIGO, { force: true });
      const campos = page.locator('input:visible:not([type=hidden])');
      const n = await campos.count();
      if (n >= codigo.length) for (let i = 0; i < codigo.length; i++) await campos.nth(i).fill(codigo[i]);
      else await campos.first().fill(codigo);
      await page.waitForTimeout(3000);
      if ((await esperarApp(page, 1)) === 'codigo') await page.locator('button:visible').last().click().catch(() => {});
      log('Código informado.');
      return;
    }
    await dormir(2000);
  }
  const e = new Error('Código de verificação do e-mail não informado a tempo.');
  e.codigo = 2;
  throw e;
}

async function esperarCaptcha(page) {
  if (HEADLESS) {
    const e = new Error('O login pediu reCAPTCHA (modo headless). Rode node login.js com janela.');
    e.codigo = 2;
    throw e;
  }
  log('O login pediu reCAPTCHA. Resolva na janela (até 15 min); o robô clica em ENTRAR depois.');
  await page.waitForFunction(() => {
    const t = document.querySelector('textarea[name="g-recaptcha-response"]');
    return t && t.value.length > 0;
  }, null, { timeout: 900000 });
}

// GET na API do gateway com o token da sessão. caminho é relativo a /api/v1/ (ex.: "enc/dashboard/summary").
async function api(ctx, caminho, params = {}) {
  if (!ctx.token) throw new Error('Token da API ainda não capturado.');
  const u = new URL(caminho, GATEWAY);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { authorization: 'Bearer ' + ctx.token, accept: 'application/json' } });
  if (!r.ok) throw new Error(`API ${u.pathname} HTTP ${r.status}`);
  return r.json();
}

// POST de CONSULTA na API (ex.: filtros de relatório). Não usar para nada que altere dados.
async function apiPost(ctx, caminho, corpo) {
  if (!ctx.token) throw new Error('Token da API ainda não capturado.');
  const u = new URL(caminho, GATEWAY);
  const r = await fetch(u, { method: 'POST', headers: { authorization: 'Bearer ' + ctx.token, accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`API ${u.pathname} HTTP ${r.status}`);
  return r.json();
}

// Espera o app disparar pelo menos uma chamada autenticada (o token só aparece depois disso).
async function esperarToken(ctx, limite = 30000) {
  const fim = Date.now() + limite;
  while (!ctx.token && Date.now() < fim) await dormir(300);
  if (!ctx.token) throw new Error('O app não chamou a API com token (sessão inválida?).');
  return ctx.token;
}

module.exports = { APP, GATEWAY, OUT, PROFILE, HEADLESS, log, dormir, abrir, garantirLogin, esperarApp, esperarToken, api, apiPost };
