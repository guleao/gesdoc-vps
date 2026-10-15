// Mapeia telas candidatas a upload de documentos. SOMENTE LEITURA: nunca clica em enviar/salvar/anexar.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://newcontract.contractweb.com.br';
const OUT = path.join(__dirname, 'out', 'upload');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TELAS = [
  ['criar-link', '/LinksContratante/CriarLink'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, 'profile'), { executablePath: CHROME, headless: false, viewport: { width: 1366, height: 850 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  const reqs = [];
  page.on('request', (r) => { if (['xhr', 'fetch'].includes(r.resourceType())) reqs.push(`${r.method()} ${r.url().replace(BASE, '').slice(0, 160)}`); });
  try {
    await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
    if (await page.$('#password')) {
      await page.fill('#Login', process.env.BERNHOEFT_USER || '').catch(() => {});
      await page.fill('#password', process.env.BERNHOEFT_PASSWORD || '').catch(() => {});
      console.log('Usuário e senha preenchidos. Marque o reCAPTCHA e clique em Login na janela.');
      await page.waitForSelector('#password', { state: 'detached', timeout: 900000 });
    }
    for (const [nome, rota] of TELAS) {
      reqs.length = 0;
      await page.goto(BASE + rota, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: true });
      fs.writeFileSync(path.join(OUT, `${nome}.html`), await page.content(), 'utf8');
      const texto = await page.locator('body').innerText();
      const uploads = await page.$$eval('input[type=file]', (els) => els.map((e) => ({ id: e.id, name: e.name, accept: e.accept, multiple: e.multiple })));
      fs.writeFileSync(path.join(OUT, `${nome}.txt`), `URL: ${page.url()}\n\ninputs file: ${JSON.stringify(uploads)}\n\nxhr:\n${reqs.join('\n')}\n\n${texto}`, 'utf8');
      console.log(`${nome}: ${page.url().replace(BASE, '')} | inputs file: ${uploads.length} | xhr: ${reqs.length}`);
    }
  } catch (e) {
    console.error('ERRO:', e.message);
  } finally {
    await ctx.close().catch(() => {});
  }
})();
