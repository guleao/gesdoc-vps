// Exploração SOMENTE LEITURA: loga, abre as telas de documentos e grava cada resposta JSON do gateway em
// out/explorar/ (URL, status e corpo), mais um print de cada tela. Serve para mapear a API antes do pendencias.js.
// Uso: node explorar.js            (rotas padrão)
//      node explorar.js /rota ...  (só as rotas indicadas)
const fs = require('fs');
const path = require('path');
const { APP, OUT, log, abrir, garantirLogin, esperarToken } = require('./comum');

const ROTAS = process.argv.slice(2).filter((a) => a.startsWith('/'));
const PADRAO = ['/dashboard', '/dashboard/provider', '/document-schedule', '/documents', '/employees', '/reports/index', '/notifications'];
const DIR = path.join(OUT, 'explorar');

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const { ctx, page } = await abrir();
  const capturas = [];
  ctx.on('response', async (r) => {
    const u = r.url();
    if (!u.startsWith('https://gateway.atlasfacilities.com.br/') || r.request().method() === 'OPTIONS') return;
    let corpo = null;
    try {
      corpo = /json/.test(r.headers()['content-type'] || '') ? await r.json() : `<${r.headers()['content-type']}>`;
    } catch {}
    capturas.push({ tela: page.url().replace(APP, ''), metodo: r.request().method(), url: u, status: r.status(), corpo_req: r.request().postData() || undefined, corpo });
  });
  try {
    await garantirLogin(page);
    await esperarToken(ctx);
    // Menu lateral: textos e links, para saber o que esta conta enxerga.
    const menu = await page.$$eval('afm-sidebar a, afm-sidebar [routerlink], afm-sidebar li', (els) =>
      els.map((e) => ({ texto: e.innerText.trim().replace(/\s+/g, ' '), href: e.getAttribute('href') || e.getAttribute('routerlink') })).filter((m) => m.texto)
    ).catch(() => []);
    fs.writeFileSync(path.join(DIR, 'menu.json'), JSON.stringify(menu, null, 2), 'utf8');
    log(`Menu: ${[...new Set(menu.map((m) => m.texto))].join(' | ')}`);
    for (const rota of ROTAS.length ? ROTAS : PADRAO) {
      log(`Abrindo ${rota}`);
      await page.goto(APP + rota, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(2500);
      const nome = rota.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'raiz';
      await page.screenshot({ path: path.join(DIR, `${nome}.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(DIR, `${nome}.txt`), `${page.url()}\n\n${await page.innerText('body').catch(() => '')}`, 'utf8');
    }
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exitCode = e.codigo || 1;
  } finally {
    fs.writeFileSync(path.join(DIR, 'api.json'), JSON.stringify(capturas, null, 2), 'utf8');
    log(`${capturas.length} resposta(s) da API gravadas em ${path.join(DIR, 'api.json')}`);
    await ctx.close().catch(() => {});
  }
})();
