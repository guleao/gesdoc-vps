// Robô Atlas na VPS: um processo só, com UMA fila (o perfil do Chromium não aceita dois navegadores ao mesmo tempo).
// Substitui o laço em shell do Dockerfile. Faz, em ordem e nunca duas coisas juntas:
//   - a cada INTERVALO_MIN (ou quando o painel grava out/rodar-agora): rodada completa
//       coleta (pendencias.js, que grava no Neon) -> busca na Factorial (factorial.js) -> lista de envio (enviar.js, simulação)
//       -> se o ENVIO AUTOMÁTICO estiver ligado: enviar.js --auto (envia as prontas, uma por vez, para na primeira recusa);
//   - entre as rodadas, a cada 5 s: os pedidos do painel em out/envio/pedidos/*.json
//       { acao: 'verificar' | 'enviar' | 'buscar' | 'atualizar', id, confirmo }.
// O botão do painel grava out/envio/modo.json { automatico: true|false, alterado_em }. Começa DESLIGADO (sem o arquivo = desligado).
// Ao ligar, roda uma rodada na hora (busca e envia sem esperar a próxima leitura).
// Estado para o painel: out/envio/robo.json. Saída dos scripts vai para o log do container (o painel mostra ao vivo).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUT = path.join(__dirname, 'out');
const DIR = path.join(OUT, 'envio');
const PEDIDOS = path.join(DIR, 'pedidos');
const ARQ_MODO = path.join(DIR, 'modo.json');
const ARQ_ESTADO = path.join(DIR, 'robo.json');
const SINAL = path.join(OUT, 'rodar-agora');
const INTERVALO_MIN = Number(process.env.INTERVALO_MIN || 60);
const hhmmss = () => new Date().toISOString().slice(11, 19);
const log = (m) => console.log(`[${hhmmss()}] ${m}`);
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));
const lerJson = (arq) => { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return null; } };

// out/ é do usuário da VPS (o painel roda como 1000): a pasta envio/ fica com o mesmo dono para o painel gravar nela.
function prepararPastas() {
  fs.mkdirSync(PEDIDOS, { recursive: true });
  try {
    const { uid, gid } = fs.statSync(OUT);
    for (const d of [DIR, PEDIDOS]) { fs.chownSync(d, uid, gid); fs.chmodSync(d, 0o770); }
  } catch {}
}

const estado = { iniciado_em: new Date().toISOString(), fazendo: null, desde: null, ultima_rodada: null, proxima: null, ultimo_pedido: null };
function gravarEstado() {
  const modo = lerJson(ARQ_MODO) || {};
  fs.writeFileSync(ARQ_ESTADO, JSON.stringify({ ...estado, automatico: modo.automatico === true, agora: new Date().toISOString() }, null, 2));
}
function fazendo(t) { estado.fazendo = t; estado.desde = t ? new Date().toISOString() : null; gravarEstado(); }

// Roda um script do robô e espera terminar (saída direto no log do container).
function rodar(script, args = []) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(__dirname, script), ...args], { cwd: __dirname, stdio: 'inherit' });
    p.on('exit', (code) => ok(code ?? 1));
    p.on('error', () => ok(1));
  });
}
const automatico = () => (lerJson(ARQ_MODO) || {}).automatico === true;

async function rodada(porque) {
  const r = { inicio: new Date().toISOString(), porque, codigos: {} };
  log(`Rodada (${porque}): coleta -> Factorial -> lista de envio${automatico() ? ' -> ENVIO AUTOMÁTICO' : ' (envio automático desligado)'}`);
  fazendo('coletando pendências no Atlas'); r.codigos.coleta = await rodar('pendencias.js');
  // Sem coleta nova (login pendente etc.) não busca nem envia: a lista de envio depende dela.
  if (r.codigos.coleta === 0 || r.codigos.coleta === 3) {
    if (process.env.FACTORIAL_API_KEY) { fazendo('buscando documentos na Factorial'); r.codigos.factorial = await rodar('factorial.js'); }
    fazendo('atualizando a lista de envio'); r.codigos.lista = await rodar('enviar.js');
    if (automatico()) { fazendo('ENVIANDO ao Atlas (automático)'); r.codigos.envio = await rodar('enviar.js', ['--auto']); }
  }
  r.fim = new Date().toISOString();
  estado.ultima_rodada = r;
  fazendo(null);
  return r.codigos.coleta;
}

async function atenderPedidos() {
  let arqs = [];
  try { arqs = fs.readdirSync(PEDIDOS).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
  for (const f of arqs) {
    const arq = path.join(PEDIDOS, f);
    const p = lerJson(arq) || {};
    fs.rmSync(arq, { force: true });
    const id = /^\d+$/.test(String(p.id || '')) ? String(p.id) : null;
    const confirmo = /^[0-9a-f-]{36}$/i.test(String(p.confirmo || '')) ? String(p.confirmo) : null;
    let code;
    log(`Pedido do painel: ${p.acao}${id ? ` #${id}` : ''}`);
    if (p.acao === 'verificar' && id) { fazendo(`verificando #${id} no Atlas`); code = await rodar('enviar.js', ['--verificar', '--id', id]); }
    else if (p.acao === 'enviar' && id && confirmo) { fazendo(`ENVIANDO #${id} ao Atlas`); code = await rodar('enviar.js', ['--enviar', '--id', id, '--confirmo', confirmo]); }
    else if (p.acao === 'buscar') { fazendo('buscando documentos na Factorial'); code = await rodar('factorial.js'); }
    else if (p.acao !== 'atualizar') { log(`Pedido ignorado (inválido): ${f}`); continue; }
    // Depois de qualquer ação, a lista de envio é refeita (quem foi enviado sai, quem foi achado entra).
    fazendo('atualizando a lista de envio'); await rodar('enviar.js');
    estado.ultimo_pedido = { ...p, codigo: code ?? 0, fim: new Date().toISOString() };
    fazendo(null);
  }
}

(async () => {
  prepararPastas();
  let proxima = Date.now();
  let modoVisto = (lerJson(ARQ_MODO) || {}).alterado_em || null;
  log(`Robô Atlas: coleta a cada ${INTERVALO_MIN} min; envio automático ${automatico() ? 'LIGADO' : 'desligado'}.`);
  for (;;) {
    const modo = lerJson(ARQ_MODO) || {};
    const ligouAgora = modo.alterado_em && modo.alterado_em !== modoVisto && modo.automatico === true;
    if (modo.alterado_em !== modoVisto) { log(`Envio automático ${modo.automatico === true ? 'LIGADO' : 'DESLIGADO'} pelo painel.`); modoVisto = modo.alterado_em; }
    const pedida = fs.existsSync(SINAL);
    if (pedida || ligouAgora || Date.now() >= proxima) {
      if (pedida) { fs.rmSync(SINAL, { force: true }); log('leitura pedida pelo painel'); }
      const rc = await rodada(pedida ? 'pedido no painel' : ligouAgora ? 'envio automático ligado agora' : 'horário');
      proxima = Date.now() + INTERVALO_MIN * 60000;
      estado.proxima = new Date(proxima).toISOString();
      // Mesmo texto do laço antigo: o painel lê "próxima leitura em N min".
      console.log(`[${hhmmss()}] saída ${rc}; próxima leitura em ${INTERVALO_MIN} min`);
    }
    await atenderPedidos();
    gravarEstado();
    await dormir(5000);
  }
})();
