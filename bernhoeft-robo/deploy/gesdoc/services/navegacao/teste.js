// Teste de aceite da F3.24: conecta ao serviço de navegação, abre um site público e tira um screenshot.
// Também abre MAX_SESSOES + 1 sessões ao mesmo tempo para provar que o limite segura a sobra na fila.
// Rodar na rede interna (ver README.md). Saída: /out/navegacao-teste.png e um resumo no stdout.
const { chromium } = require('playwright');

const WS = process.env.NAVEGACAO_WS || 'ws://navegacao:3000/';
const MAX = Number(process.env.MAX_SESSOES || 3);
const OUT = process.env.OUT_DIR || '/out';
// Só para teste fora do contêiner: NAVEGACAO_CANAL=chrome faz o servidor usar o Chrome instalado.
const CANAL = process.env.NAVEGACAO_CANAL ? { 'x-playwright-launch-options': JSON.stringify({ channel: process.env.NAVEGACAO_CANAL }) } : {};
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// O servidor já enfileira as conexões além do limite; aqui só se repete se ele estiver fora do ar (reinício, deploy).
async function conectar(nome, tentativas = 20) {
  for (let i = 1; ; i++) {
    try {
      return await chromium.connect(WS, { timeout: 15000, headers: CANAL });
    } catch (e) {
      if (i >= tentativas) throw e;
      log(`${nome}: servidor cheio ou indisponível, aguardando (${i}): ${e.message.split('\n')[0].slice(0, 120)}`);
      await dormir(3000);
    }
  }
}

(async () => {
  const t0 = Date.now();
  const b = await conectar('screenshot');
  const page = await b.newPage();
  await page.goto('https://example.com/', { waitUntil: 'load', timeout: 60000 });
  await page.screenshot({ path: require('path').join(OUT, 'navegacao-teste.png') });
  log(`Screenshot ok: "${await page.title()}" em ${Date.now() - t0} ms`);
  await b.close();

  // Limite de sessões: MAX + 1 ao mesmo tempo. A última só entra quando uma das primeiras sai.
  const inicio = Date.now();
  const tempos = await Promise.all(
    Array.from({ length: MAX + 1 }, async (_, i) => {
      const s = await conectar(`sessão ${i + 1}`);
      const entrou = Date.now() - inicio;
      await dormir(5000);
      await s.close();
      return entrou;
    })
  );
  tempos.sort((a, b) => a - b);
  log(`Entrada das ${MAX + 1} sessões (ms): ${tempos.join(', ')}`);
  log(tempos[MAX] >= 4000 ? `Limite de ${MAX} sessões respeitado.` : 'ATENÇÃO: a sessão extra entrou sem esperar; o limite não está valendo.');
})().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
