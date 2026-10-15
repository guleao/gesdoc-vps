// Exploração somente leitura: salva HTML/texto/screenshot das telas candidatas a "documentos pendentes".
// Usa o perfil salvo em profile/. Se a sessão caiu, espera login manual (reCAPTCHA). Não clica em SOLICITAR nem envia nada.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://newcontract.contractweb.com.br';
const OUT = path.join(__dirname, 'out', 'explorar');
const PROFILE = path.join(__dirname, 'profile');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function salvar(page, nome) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.screenshot({ path: path.join(OUT, `${nome}.png`), fullPage: true });
  fs.writeFileSync(path.join(OUT, `${nome}.html`), await page.content(), 'utf8');
  fs.writeFileSync(path.join(OUT, `${nome}.txt`), `URL: ${page.url()}\n\n${await page.locator('body').innerText()}`, 'utf8');
  log(`salvo ${nome} (${page.url()})`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME, headless: false, slowMo: 100, viewport: { width: 1366, height: 850 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  try {
    await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    if (await page.$('#password')) {
      await page.fill('#Login', process.env.BERNHOEFT_USER || '').catch(() => {});
      await page.fill('#password', process.env.BERNHOEFT_PASSWORD || '').catch(() => {});
      log('Sessão fora. Marque o reCAPTCHA e clique em Login na janela (até 15 min).');
      await page.waitForSelector('#password', { state: 'detached', timeout: 900000 });
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    log('Logado.');
    await salvar(page, '00-home');

    for (const [nome, rota] of [
      ['01-trabalhista', '/AtualizarColaborador?TipoCompetencia=0'],
      ['02-mobilizacao', '/AtualizarColaborador?TipoCompetencia=1'],
      ['03-controle-validade', '/RelatorioControleValidadeDocumentos'],
      ['04-envio-pendencia', '/EnvioRelatoriosPendencia'],
    ]) {
      await page.goto(BASE + rota, { waitUntil: 'domcontentloaded' });
      await salvar(page, nome);
    }

    // Relatório 012 (abre em nova aba pelo menu em árvore)
    await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
    for (const nivel of ['Relatórios', 'Documentos e Análise']) {
      await page.evaluate((t) => Array.from(document.querySelectorAll('a')).find((x) => x.innerText.trim() === t)?.click(), nivel);
      await page.waitForTimeout(600);
    }
    const rel = page.locator('a:visible', { hasText: '012 - Relatório de Documentos Pendentes' }).first();
    const [aba] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null), rel.click()]);
    await salvar(aba || page, '05-relatorio-012');
    if (aba) await aba.close().catch(() => {});
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exitCode = 1;
  } finally {
    await ctx.close().catch(() => {});
    log('Fim.');
  }
})();
