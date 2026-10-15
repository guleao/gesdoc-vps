const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await page.goto('https://www.airbnb.com.br/users/profile/1469681616123513332', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const links = await page.$$eval('a[href*="/rooms/"]', (as) =>
    [...new Map(as.map((a) => [a.href.split('?')[0], (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')])).entries()]
      .map(([href, texto]) => ({ href, texto }))
  );
  fs.writeFileSync('out/airbnb-links.json', JSON.stringify(links, null, 2), 'utf8');
  console.log(links.length, 'links');
  await browser.close();
})();
