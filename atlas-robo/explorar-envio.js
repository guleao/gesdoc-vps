// Exploração SOMENTE LEITURA para achar onde o prestador ENVIA um documento no portal Atlas.
// Abre /dashboard/provider, olha o menu de ações da 1ª linha e a tela de documentos exigidos de um funcionário,
// grava as chamadas do gateway, os botões, os campos de arquivo e prints. NÃO anexa arquivo e NÃO clica em
// nada com texto de envio/salvar/excluir/confirmar/exportar.
// Saída: out/explorar-envio/
const fs = require('fs');
const path = require('path');
const { APP, OUT, log, abrir, garantirLogin, esperarToken, dormir } = require('./comum');

const DIR = path.join(OUT, 'explorar-envio');
const PERIGOSO = /enviar|salvar|excluir|remover|apagar|confirmar|exportar|aprovar|reprovar|anexar|upload|finalizar|solicitar|baixar/i;

const elementos = (page) =>
  page.$$eval('button:visible, a:visible, [role=button]:visible, [role=menuitem]:visible, input[type=file], [class*=dropdown] li:visible', (els) =>
    els.map((e) => ({
      tag: e.tagName,
      texto: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      title: e.title || e.getAttribute('aria-label') || e.getAttribute('ng-reflect-message') || '',
      tipo: e.getAttribute('type'),
      accept: e.getAttribute('accept'),
      cls: String(e.className).slice(0, 80),
      href: e.getAttribute('href'),
    }))
  );

async function registrar(page, nome, saida) {
  await dormir(2500);
  await page.screenshot({ path: path.join(DIR, nome + '.png'), fullPage: true }).catch(() => {});
  fs.writeFileSync(path.join(DIR, nome + '.txt'), await page.innerText('body').catch(() => ''), 'utf8');
  saida[nome] = { url: page.url().replace(APP, ''), elementos: await elementos(page).catch(() => []) };
  log(`${nome}: ${saida[nome].url} (${saida[nome].elementos.length} elementos)`);
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
    await page.goto(APP + '/dashboard/provider', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('table tbody tr', { timeout: 60000 });
    // Janela de boas-vindas tampa a tela: fecha pelo X.
    await page.getByText('Close', { exact: true }).first().click({ timeout: 4000 }).catch(() => page.keyboard.press('Escape'));
    await dormir(1000);
    await registrar(page, '1-acompanhamento', saida);

    // Ícone de upload da 1ª linha: só abre o diálogo, não anexa nem confirma.
    const linha = page.locator('table tbody tr').first();
    const icone = linha.locator('td').last().locator('button, a, i, svg, [class*=upload], [class*=icon]').first();
    log('Ícones na última célula: ' + (await linha.locator('td').last().evaluate((e) => e.innerHTML.slice(0, 300))));
    if (await icone.count()) {
      await icone.click({ timeout: 5000 }).catch((e) => log('clique no ícone falhou: ' + e.message.slice(0, 80)));
      await registrar(page, '2-dialogo-do-icone', saida);
      const campos = await page.locator('input[type=file]').count();
      log('Campos de arquivo na tela: ' + campos);
      await page.keyboard.press('Escape').catch(() => {});
    }
    const achados = Object.entries(saida).flatMap(([t, v]) => v.elementos.filter((e) => e.tipo === 'file' || /envi|anex|upload/i.test(e.texto + e.title)).map((e) => `${t}: ${e.texto || e.title || e.tipo}${PERIGOSO.test(e.texto) ? ' (NÃO clicado)' : ''}`));
    log('Candidatos a envio:\n  ' + (achados.join('\n  ') || '(nenhum encontrado)'));
  } catch (e) {
    console.error('ERRO:', e.message);
    await page.screenshot({ path: path.join(DIR, 'erro.png') }).catch(() => {});
    process.exitCode = e.codigo || 1;
  } finally {
    fs.writeFileSync(path.join(DIR, 'elementos.json'), JSON.stringify(saida, null, 2), 'utf8');
    fs.writeFileSync(path.join(DIR, 'api.json'), JSON.stringify(capturas, null, 2), 'utf8');
    log(`${capturas.length} resposta(s) da API gravadas em ${DIR}`);
    await ctx.close();
  }
})();
