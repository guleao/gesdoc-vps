// Ciclo do robô Atlas: coletar -> gravar no Neon -> conferir envio (SIMULAÇÃO). Com trava, log e aviso por webhook.
//
// Uso:
//   node ciclo.js                 roda o ciclo (coleta + Neon + simulação de envio)
//   node ciclo.js --sem-coleta    pula a coleta (usa a última coleta local)
//   node ciclo.js --simular       neon.js só simula (não grava)
// Variáveis: GESDOC_WEBHOOK_URL (opcional, recebe JSON com o resumo), CICLO_TRAVA_MIN (padrão 60).
//
// Regras: somente leitura no portal. O envio real NÃO existe: enviar.js só simula, e o ciclo nunca passa --enviar.
// A união de PDFs (compor.js) fica fora do ciclo até combinar com o Evilásio quem une e onde ficam as partes.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT = path.join(__dirname, 'out');
const TRAVA = path.join(OUT, 'ciclo.lock');
const LOG = path.join(OUT, 'ciclo.log');
const TRAVA_MIN = Number(process.env.CICLO_TRAVA_MIN || 60);

const limpar = (s) => String(s).replace(/postgres(ql)?:\/\/\S+/g, '<url>');
function log(msg) {
  const linha = `${new Date().toISOString()} ${limpar(msg)}`;
  console.log(linha);
  fs.appendFileSync(LOG, linha + '\n');
}

function pegarTrava() {
  if (fs.existsSync(TRAVA)) {
    const idade = (Date.now() - fs.statSync(TRAVA).mtimeMs) / 60000;
    if (idade < TRAVA_MIN) return false;
    log(`Trava antiga (${Math.round(idade)} min) removida.`);
  }
  fs.writeFileSync(TRAVA, String(process.pid));
  return true;
}

function etapa(nome, script, args = []) {
  log(`== ${nome}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: __dirname, encoding: 'utf8', timeout: 30 * 60 * 1000 });
  const saida = limpar(`${r.stdout || ''}${r.stderr || ''}`).trim().split('\n').slice(-12).join('\n');
  if (saida) log(saida);
  const ok = r.status === 0;
  if (!ok) log(`FALHOU: ${nome} (código ${r.status})`);
  return ok;
}

async function avisar(resumo) {
  const url = process.env.GESDOC_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(resumo) });
  } catch (e) {
    log(`Webhook falhou: ${limpar(e.message)}`);
  }
}

(async () => {
  const args = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  if (!pegarTrava()) {
    log('Outro ciclo está em andamento (trava ativa); saindo.');
    process.exitCode = 3;
    return;
  }
  const resumo = { inicio: new Date().toISOString(), etapas: {} };
  try {
    if (!args.includes('--sem-coleta')) {
      resumo.etapas.coleta = etapa('coletar (pendencias.js)', 'pendencias.js');
      if (!resumo.etapas.coleta) throw new Error('coleta falhou; parei antes de gravar.');
    }
    resumo.etapas.neon = etapa('gravar no Neon (neon.js)', 'neon.js', args.includes('--simular') ? ['--simular'] : []);
    resumo.etapas.envio_simulado = etapa('conferir envio, simulação (enviar.js)', 'enviar.js');
    resumo.ok = Object.values(resumo.etapas).every(Boolean);
  } catch (e) {
    resumo.ok = false;
    resumo.erro = limpar(e.message);
    log(`ERRO: ${resumo.erro}`);
  } finally {
    fs.rmSync(TRAVA, { force: true });
  }
  resumo.fim = new Date().toISOString();
  log(`Ciclo ${resumo.ok ? 'OK' : 'COM FALHA'}.`);
  await avisar(resumo);
  process.exitCode = resumo.ok ? 0 : 1;
})();
