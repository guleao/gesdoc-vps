// Diagnóstico somente leitura: abre o portal no perfil salvo e descreve o menu lateral. Não clica em nada.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, 'profile');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1366, height: 850 },
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://newcontract.contractweb.com.br/Home', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const info = await page.evaluate(() => {
    const alvo = Array.from(document.querySelectorAll('a')).find((a) => a.innerText.trim() === 'Documentos e Análise');
    const ponto = document.elementFromPoint(109, 29);
    const descreve = (el) => (el ? { tag: el.tagName, id: el.id, cls: el.className, title: el.getAttribute('title'), html: el.outerHTML.slice(0, 400) } : null);
    let pai = alvo;
    const cadeia = [];
    for (let i = 0; i < 4 && pai; i++) {
      cadeia.push(descreve(pai));
      pai = pai.parentElement;
    }
    return {
      alvo: descreve(alvo),
      alvoVisivel: alvo ? alvo.getBoundingClientRect().width > 0 : false,
      cadeiaParentes: cadeia,
      pontoHamburguer: descreve(ponto),
      sidebar: Array.from(document.querySelectorAll('[class*="sidebar"], [class*="menu"], nav')).slice(0, 5).map(descreve),
    };
  });
  fs.writeFileSync(path.join(OUT, 'diag-menu.json'), JSON.stringify(info, null, 2), 'utf8');
  console.log('Gravado em out/diag-menu.json');
  await context.close();
})();
