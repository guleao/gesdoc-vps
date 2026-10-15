// Login manual para renovar a sessão salva em profile/ (resolve o reCAPTCHA com uma pessoa).
// No servidor: ssh -X usuario@vps  e depois  node login.js   (ou via VNC). Não envia nada.
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BERNHOEFT_URL || 'https://newcontract.contractweb.com.br';
const PROFILE = process.env.PROFILE_DIR || path.join(__dirname, 'profile');
const CHROME = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    viewport: { width: 1280, height: 800 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
  if (await page.$('#password')) {
    await page.fill('#Login', process.env.BERNHOEFT_USER || '').catch(() => {});
    await page.fill('#password', process.env.BERNHOEFT_PASSWORD || '').catch(() => {});
    console.log('Usuário e senha preenchidos. Marque o reCAPTCHA e clique em Login (até 15 min).');
    await page.waitForSelector('#password', { state: 'detached', timeout: 900000 });
  }
  console.log('Sessão salva em', PROFILE);
  await ctx.close();
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
