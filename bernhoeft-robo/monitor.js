// Monitor somente leitura do portal Bernhoeft (ContractWeb).
// Usa um perfil fixo do Chrome em profile/, para manter a sessão entre execuções.
// Você resolve o reCAPTCHA e clica em Login. O script detecta o login e passa a monitorar.
// Se a sessão cair, o script para e pede novo login. Não tenta logar sozinho e não envia nada.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BERNHOEFT_URL || 'https://newcontract.contractweb.com.br/';
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN || 10);
const OUT = path.join(__dirname, 'out');
const PROFILE = path.join(__dirname, 'profile');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function estaLogado(page) {
  return (await page.$('#password')) === null;
}

async function aguardarLogin(page) {
  log('Faça login na janela: marque o reCAPTCHA e clique em Login (até 15 min)');
  await page.waitForSelector('#password', { state: 'detached', timeout: 900000 }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  return estaLogado(page);
}

async function lerPendencias(page, ciclo) {
  const itens = await page.$$eval('a, button', (els) =>
    els
      .map((el) => ({ texto: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '), href: el.getAttribute('href') || '' }))
      .filter((x) => x.texto)
  );
  fs.writeFileSync(path.join(OUT, 'menu.json'), JSON.stringify(itens, null, 2), 'utf8');

  // Relatório fica dentro do menu "Documentos e Análise", que precisa estar aberto para o link aparecer
  // Menu em árvore: "Relatórios" > "Documentos e Análise" > "012 - ...". Cada nível precisa ser aberto antes do próximo.
  // Clique via JavaScript funciona mesmo com o item oculto.
  const clicarNoMenu = (texto) =>
    page.evaluate((t) => {
      const a = Array.from(document.querySelectorAll('a')).find((x) => x.innerText.trim() === t);
      if (!a) return false;
      a.click();
      return true;
    }, texto);

  for (const nivel of ['Relatórios', 'Documentos e Análise']) {
    if (!(await clicarNoMenu(nivel))) throw new Error(`Menu "${nivel}" não encontrado.`);
    await page.waitForTimeout(600);
  }
  const relatorio = page.locator('a:visible', { hasText: '012 - Relatório de Documentos Pendentes' });
  await relatorio.first().waitFor({ state: 'visible', timeout: 10000 });

  // O relatório abre em nova aba; se abrir, lemos a nova aba
  const [novaAba] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 15000 }).catch(() => null),
    relatorio.first().click(),
  ]);
  const pagina = novaAba || page;
  await pagina.waitForLoadState('networkidle').catch(() => {});
  await pagina.screenshot({ path: path.join(OUT, 'pendencias.png'), fullPage: true });

  const tabelas = await pagina.$$eval('table', (ts) =>
    ts.map((t) => Array.from(t.rows).map((r) => Array.from(r.cells).map((c) => c.innerText.trim().replace(/\s+/g, ' ')).join(' | ')).join('\n'))
  );
  const texto = await pagina.locator('body').innerText();
  const agora = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'pendencias.txt'), `Coletado em ${agora} (ciclo ${ciclo})\n\n${tabelas.join('\n\n---\n\n')}\n\n=== TEXTO DA PÁGINA ===\n${texto}`, 'utf8');
  if (novaAba) await novaAba.close().catch(() => {});
  log(`Pendências salvas em out/pendencias.txt (${tabelas.length} tabela(s))`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    slowMo: 100,
    viewport: { width: 1366, height: 850 },
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  context.on('close', () => log('Contexto do navegador fechado (evento close).'));
  page.on('close', () => log('Aba fechada (evento close).'));
  log(`Janela aberta. Páginas abertas: ${context.pages().length}`);

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    if (!(await estaLogado(page))) {
      await page.fill('#Login', process.env.BERNHOEFT_USER);
      await page.fill('#password', process.env.BERNHOEFT_PASSWORD);
      const ok = await aguardarLogin(page);
      if (!ok) throw new Error('Login não concluiu no prazo.');
    }
    log(`Logado. URL: ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: true });

    for (let ciclo = 1; ; ciclo++) {
      await lerPendencias(page, ciclo);
      log(`Próxima leitura em ${INTERVALO_MIN} min. Feche a janela ou Ctrl+C para parar.`);
      await dormir(INTERVALO_MIN * 60 * 1000);

      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      if (!(await estaLogado(page))) {
        log('Sessão encerrada pelo portal. Rode o script de novo e faça login na janela.');
        process.exitCode = 2;
        break;
      }
    }
  } catch (err) {
    console.error('ERRO:', err.message);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    log('Navegador fechado.');
  }
})();
