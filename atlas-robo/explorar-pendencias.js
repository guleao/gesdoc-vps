// Exploração SOMENTE LEITURA da tela "Acompanhamento de entregas" (/dashboard/provider) e do relatório
// "Entrega de docs dos funcionários": espera a tabela carregar, grava as chamadas do gateway e lista os botões
// (para achar o de exportar). Não clica em nada que altere dados.
// Saída: out/explorar-pendencias/ (api.json, botoes.json, prints).
const fs = require('fs');
const path = require('path');
const { APP, OUT, log, abrir, garantirLogin, esperarToken, dormir } = require('./comum');

const DIR = path.join(OUT, 'explorar-pendencias');

async function esperarTabela(page, limite = 120000) {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    // A tela mostra "esqueletos" cinzas enquanto carrega; espera sumirem.
    const carregando = await page.$$eval('[class*="skeleton"], [class*="shimmer"], [class*="placeholder-glow"], ngx-skeleton-loader', (e) => e.length).catch(() => 0);
    if (!carregando) return true;
    await dormir(1000);
  }
  return false;
}

async function botoes(page) {
  return page.$$eval('button:visible, a:visible, [role=button]:visible', (els) =>
    els.map((e) => ({ tag: e.tagName, texto: (e.innerText || '').trim().slice(0, 60), title: e.title || e.getAttribute('aria-label') || e.getAttribute('mattooltip') || e.getAttribute('ng-reflect-message') || '', cls: String(e.className).slice(0, 80), href: e.getAttribute('href') }))
  );
}

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
  const saida = {};
  try {
    await garantirLogin(page, '/dashboard/provider');
    await esperarToken(ctx);

    log('Abrindo Acompanhamento de entregas (/dashboard/provider)');
    await page.goto(APP + '/dashboard/provider', { waitUntil: 'domcontentloaded' });
    log(`Tabela carregou: ${await esperarTabela(page)}`);
    await dormir(2000);
    await page.screenshot({ path: path.join(DIR, 'acompanhamento.png'), fullPage: true });
    fs.writeFileSync(path.join(DIR, 'acompanhamento.txt'), await page.innerText('body'), 'utf8');
    saida.acompanhamento = await botoes(page);

    log('Abrindo Relatório de documentos > Entrega de docs dos funcionários');
    await page.goto(APP + '/reports/index', { waitUntil: 'domcontentloaded' });
    await page.getByText('Entrega de docs dos funcionários').first().click();
    await dormir(3000);
    log(`Tabela carregou: ${await esperarTabela(page)} (${page.url()})`);
    await dormir(2000);
    await page.screenshot({ path: path.join(DIR, 'entrega-funcionarios.png'), fullPage: true });
    fs.writeFileSync(path.join(DIR, 'entrega-funcionarios.txt'), await page.innerText('body'), 'utf8');
    saida.entregaFuncionarios = { url: page.url(), botoes: await botoes(page) };
  } catch (e) {
    console.error('ERRO:', e.message);
    await page.screenshot({ path: path.join(DIR, 'erro.png') }).catch(() => {});
    process.exitCode = e.codigo || 1;
  } finally {
    fs.writeFileSync(path.join(DIR, 'botoes.json'), JSON.stringify(saida, null, 2), 'utf8');
    fs.writeFileSync(path.join(DIR, 'api.json'), JSON.stringify(capturas, null, 2), 'utf8');
    log(`${capturas.length} resposta(s) da API gravadas em ${DIR}`);
    await ctx.close();
  }
})();
