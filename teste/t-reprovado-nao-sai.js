// Teste da regra de 28/10 no enviar.js: reprovada (…Rejected) não fica pronta nem sai; 22006 segura sozinha.
// Tudo falso: Neon, atlas.db, Atlas (api + fetch). Rodar: node teste/t-reprovado-nao-sai.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ORIG = process.argv[2] || path.join(__dirname, '..', 'atlas-robo', 'enviar.js');
const D = fs.mkdtempSync(path.join(require('os').tmpdir(), 't-reprovado-'));
fs.rmSync(D, { recursive: true, force: true });
const OUT = path.join(D, 'out');
fs.mkdirSync(path.join(OUT, 'envio'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'downloads', 'sharepoint'), { recursive: true });
fs.copyFileSync(ORIG, path.join(D, 'enviar.js'));
for (const f of ['conteudo.js', 'ler-pdf.js']) fs.copyFileSync(path.join(path.dirname(ORIG), f), path.join(D, f));
fs.cpSync(path.join(path.dirname(ORIG), 'vendor'), path.join(D, 'vendor'), { recursive: true });

// [id, status na coleta, status no general-information, resposta do upload]
const CASOS = [
  [1, 'DelayNotSent', 'Delay', 200],
  [2, 'DelayRejected', 'DelayRejected', 400],
  [3, 'PendingRejected', 'PendingRejected', 400],
  [4, 'PendingNotSent', 'DelayRejected', 400],
  [5, 'DelayNotSent', 'Delay', 22006],
  [6, 'PendingNotSent', 'Pending', 200],
];
const sid = (i) => `0000000${i}-0000-0000-0000-000000000000`;
const db = new DatabaseSync(path.join(OUT, 'atlas.db'));
db.exec(`CREATE TABLE coletas (id INTEGER PRIMARY KEY);
  CREATE TABLE pendencias (coleta_id INT, aba TEXT, status TEXT, documento TEXT, cpf TEXT, cnpj_filial TEXT, pedido TEXT, unidades TEXT, competencia TEXT, prazo_envio TEXT, document_schedule_id TEXT);
  INSERT INTO coletas VALUES (1);`);
for (const [i, st] of CASOS) {
  db.prepare(`INSERT INTO pendencias VALUES (1, ?, ?, ?, NULL, '1', NULL, 'U', '08/2026', '2026-09-10', ?)`).run(st.startsWith('Pending') ? 'Próximas entregas' : 'Atrasados', st, `Doc ${i}`, sid(i));
  fs.writeFileSync(path.join(OUT, 'downloads', 'sharepoint', `IT${i}.pdf`), `%PDF-1.4\n%${i}\n%%EOF\n`);
}
db.close();
fs.writeFileSync(path.join(OUT, 'envio', 'modo.json'), JSON.stringify({ liberado: true, automatico: true }));

fs.writeFileSync(path.join(D, 'neon.js'), `exports.conexao = () => 'postgres://falso';`);
fs.writeFileSync(path.join(D, 'comum.js'), `
const path = require('path');
const CASOS = ${JSON.stringify(CASOS)};
const sid = ${sid.toString()};
exports.APP = 'https://app'; exports.GATEWAY = 'https://gw/'; exports.OUT = path.join(__dirname, 'out');
exports.log = (m) => console.log(m); exports.dormir = async () => {};
exports.abrir = async () => ({ ctx: { token: 't', close: async () => {} }, page: {} });
exports.garantirLogin = async () => {}; exports.esperarToken = async () => {};
exports.api = async (ctx, url) => { const c = CASOS.find((x) => url.includes(sid(x[0]))); return { name: 'Doc ' + c[0], status: c[2], type_upload: 'ManualByProvider', file_format: ['PDF'] }; };
`);
fs.writeFileSync(path.join(D, 'falsos.js'), `
const Module = require('module'); const orig = Module._load;
const CASOS = ${JSON.stringify(CASOS)}; const sid = ${sid.toString()};
const linhas = CASOS.map(([i]) => ({ id: i, doc_id: 3, nome: 'Doc ' + i, competencia: '08/2026', estado: 'LOCALIZADO', caminho_origem: 'sharepoint:IT' + i, unidade: 'U', cnpj_filial: '1', prazo_envio: '2026-09-10', cpf: null, numero_pedido: null, hash_arquivo: null, tamanho_bytes: null }));
Module._load = function (req, ...r) {
  if (req === '@neondatabase/serverless') return { neon: () => ({ query: async (q, p) => /^\\s*update/i.test(q) ? [] : /hash_arquivo is not null/.test(q) ? [] : /id = \\$2/.test(q) ? linhas.filter((l) => l.id === p[1]) : linhas }) };
  return orig.call(this, req, ...r);
};
global.fetch = async (url, o) => { const s = o.body.get('json'); const c = CASOS.find((x) => s.includes(sid(x[0])));
  if (c[3] === 200) return { ok: true, status: 200, text: async () => '{}' };
  const corpo = c[3] === 22006 ? '{"error":{"code":22006,"message":"Documento já importado!"}}' : '{"error":{"code":1}}';
  return { ok: false, status: 400, text: async () => corpo }; };
`);

const rodar = (...a) => { try { return execFileSync(process.execPath, ['-r', path.join(D, 'falsos.js'), path.join(D, 'enviar.js'), ...a], { cwd: D, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
const sim = () => JSON.parse(fs.readFileSync(path.join(OUT, 'enviar-simulacao.json'), 'utf8')).itens;
let ok = 0, falhou = 0;
const t = (nome, cond) => { if (cond) ok++; else falhou++; console.log((cond ? 'ok    ' : 'FALHOU') + ' ' + nome); };

rodar();
let it = sim();
const p = (i) => it.find((x) => x.id === i);
t('1 DelayNotSent fica pronta', p(1).pronta);
t('6 PendingNotSent fica pronta', p(6).pronta);
t('2 DelayRejected NÃO fica pronta', !p(2).pronta && p(2).acao_portal && p(2).motivos.some((m) => /precisa de ação no portal: reprovada/.test(m)));
t('3 PendingRejected NÃO fica pronta', !p(3).pronta && p(3).acao_portal);
t('4 e 5 (NotSent na coleta) ficam prontas', p(4).pronta && p(5).pronta);

const sAuto = rodar('--auto');
const res = JSON.parse(fs.readFileSync(path.join(OUT, 'envio', 'resultados.json'), 'utf8'));
const seg = JSON.parse(fs.readFileSync(path.join(OUT, 'envio', 'segurar.json'), 'utf8'));
t('auto: tentou só 1 4 5 6', Object.keys(res).sort().join() === '1,4,5,6');
t('auto: 1 e 6 enviados', res[1].ok && res[6].ok);
t('auto: 4 barrado na conferência (reprovada agora no Atlas), sem upload', !res[4].ok && /NÃO ENVIEI: precisa de ação no portal: reprovada/.test(res[4].msg));
t('auto: 5 recusado 22006', !res[5].ok && /22006/.test(res[5].msg));
t('auto: só o 5 foi segurado sozinho', Object.keys(seg).join() === '5' && seg[5].auto === true);
t('auto: registro da segurada no log', /#5 segurada sozinha/.test(sAuto));

rodar();
it = sim();
t('depois: 5 segurada não fica pronta', !p(5).pronta && p(5).segurada);

// manual com 22006 também segura (apaga a segurada antes)
fs.writeFileSync(path.join(OUT, 'envio', 'segurar.json'), '{}');
rodar('--enviar', '--id', '5', '--confirmo', sid(5));
const seg2 = JSON.parse(fs.readFileSync(path.join(OUT, 'envio', 'segurar.json'), 'utf8'));
t('manual: 22006 segura sozinho', !!seg2[5]);
// manual em reprovada: recusa sem chamar upload
rodar('--enviar', '--id', '2', '--confirmo', sid(2));
const r2 = JSON.parse(fs.readFileSync(path.join(OUT, 'envio', 'resultados.json'), 'utf8'))[2];
t('manual: reprovada recusada antes do upload', !r2.ok && /não está pronta: .*reprovada/.test(r2.msg));

console.log(`\n${ok} ok, ${falhou} falhou`);
fs.rmSync(D, { recursive: true, force: true });
process.exitCode = falhou ? 1 : 0;
