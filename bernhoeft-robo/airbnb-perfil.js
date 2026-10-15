const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto('https://www.airbnb.com.br/users/profile/1469681616123513332', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: 'out/airbnb-perfil.png', fullPage: true });
  const texto = await page.locator('body').innerText().catch(() => '');
  require('fs').writeFileSync('out/airbnb-perfil.txt', texto, 'utf8');
  console.log('titulo:', await page.title());
  await browser.close();
})();
