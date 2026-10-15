// Login com janela para renovar a sessão salva em profile/ (útil se o portal pedir reCAPTCHA). Não envia nada.
const { abrir, garantirLogin, log, PROFILE } = require('./comum');

(async () => {
  const { ctx, page } = await abrir();
  try {
    await garantirLogin(page);
    log('Sessão salva em ' + PROFILE);
  } catch (e) {
    console.error('ERRO:', e.message);
    process.exitCode = e.codigo || 1;
  } finally {
    await ctx.close().catch(() => {});
  }
})();
