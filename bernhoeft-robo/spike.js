// Spike somente leitura: login no portal Bernhoeft (ContractWeb) e leitura da tela de pendências.
// Não envia nenhum documento. Credenciais vêm de variáveis de ambiente e nunca são impressas.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BERNHOEFT_URL || 'https://newcontract.contractweb.com.br/';
const USER = process.env.BERNHOEFT_USER;
const PASS = process.env.BERNHOEFT_PASSWORD;
const HEADLESS = process.env.HEADLESS === '1';
const OUT = path.join(__dirname, 'out');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);

(async () => {
  if (!USER || !PASS) {
    throw new Error('BERNHOEFT_USER ou BERNHOEFT_PASSWORD não estão definidas no ambiente.');
  }
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: CHROME, headless: HEADLESS, slowMo: 150 });
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  page.setDefaultTimeout(30000);

  try {
    log(`Abrindo ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: path.join(OUT, '01-login.png'), fullPage: true });

    log('Preenchendo login');
    await page.fill('#Login', USER);
    await page.fill('#password', PASS);
    await page.screenshot({ path: path.join(OUT, '02-preenchido.png') });

    // O reCAPTCHA exige uma pessoa: marcar "Não sou um robô" e clicar em Login na janela do Chrome.
    log('Aguardando você marcar o reCAPTCHA e clicar em Login (até 15 min)');
    await page.waitForSelector('#password', { state: 'detached', timeout: 900000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.screenshot({ path: path.join(OUT, '03-pos-login.png'), fullPage: true });

    const stillLogin = await page.$('#password');
    if (stillLogin) {
      const erro = (await page.locator('body').innerText()).slice(0, 600);
      log('Continua na tela de login. Texto visível (início):');
      console.log(erro);
      throw new Error('Login não concluiu. Veja out/03-pos-login.png.');
    }
    log(`Login ok. URL: ${page.url()} | Título: ${await page.title()}`);

    // Lista links e botões de navegação para descobrir onde estão as pendências
    const itens = await page.$$eval('a, button', (els) =>
      els
        .map((el) => ({ texto: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '), href: el.getAttribute('href') || '' }))
        .filter((x) => x.texto)
    );
    fs.writeFileSync(path.join(OUT, 'menu.json'), JSON.stringify(itens, null, 2), 'utf8');
    log(`${itens.length} links/botões salvos em out/menu.json`);

    const alvo = itens.find((x) => /pend[eê]n/i.test(x.texto) || /pend/i.test(x.href));
    if (!alvo) {
      log('Nenhum link de pendências encontrado no menu. Veja out/menu.json e out/03-pos-login.png.');
    } else {
      log(`Abrindo pendências: "${alvo.texto}" ${alvo.href}`);
      await page.getByText(alvo.texto, { exact: false }).first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.screenshot({ path: path.join(OUT, '04-pendencias.png'), fullPage: true });

      const tabelas = await page.$$eval('table', (ts) =>
        ts.map((t) => Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => c.innerText.trim().replace(/\s+/g, ' ')).join(' | ')).join('\n'))
      );
      const texto = await page.locator('body').innerText();
      fs.writeFileSync(path.join(OUT, 'pendencias.txt'), `${tabelas.join('\n\n---\n\n')}\n\n=== TEXTO DA PÁGINA ===\n${texto}`, 'utf8');
      log(`${tabelas.length} tabela(s) encontradas. Salvo em out/pendencias.txt`);
    }
  } finally {
    await browser.close();
    log('Navegador fechado.');
  }
})().catch((err) => {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
});
