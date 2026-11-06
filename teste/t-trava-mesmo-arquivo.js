// Teste da trava "um arquivo ligado a várias pessoas" e da leitura do conteúdo no enviar.js do Atlas (29/10).
// Tudo falso: Neon, atlas.db, Atlas (api + upload). Nenhum dado real. Rodar: node teste/t-trava-mesmo-arquivo.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const ATLAS = path.join(__dirname, '..', 'atlas-robo');
const D = fs.mkdtempSync(path.join(os.tmpdir(), 't-trava-'));
const OUT = path.join(D, 'out');
fs.mkdirSync(path.join(OUT, 'envio'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'downloads', 'sharepoint'), { recursive: true });
for (const f of ['enviar.js', 'conteudo.js', 'ler-pdf.js']) fs.copyFileSync(path.join(ATLAS, f), path.join(D, f));
fs.cpSync(path.join(ATLAS, 'vendor'), path.join(D, 'vendor'), { recursive: true });

function pdf(linhas) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m);
  const c = 'BT /F1 11 Tf 50 780 Td 14 TL ' + linhas.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', `<< /Length ${Buffer.byteLength(c, 'latin1')} >>\nstream\n${c}\nendstream`];
  let s = '%PDF-1.4\n';
  const pos = [];
  objs.forEach((o, i) => { pos.push(Buffer.byteLength(s, 'latin1')); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(s + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, 'latin1');
}
const cpf = (b) => { const d = b.split('').map(Number); for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i); d.push(((s * 10) % 11) % 10); } return d.join(''); };
const A = cpf('123456789'), B = cpf('987654321'), C = cpf('111444777');

// Casos: [id, doc_id, cpf, arquivo, hash no Neon de OUTRA pendência?]
const ESOCIAL_AB = pdf(['Comprovante de baixa no eSocial', 'Carteira de trabalho digital', `CPF ${A}`, `CPF ${B}`]);
const CASOS = [
  [1, 68, A, ESOCIAL_AB],                                                     // mesmo arquivo do 2, outra pessoa
  [2, 68, B, ESOCIAL_AB],                                                     // mesmo arquivo do 1
  [3, 68, C, pdf(['Comprovante de baixa no eSocial', 'Carteira de trabalho digital', `CPF ${C}`, 'versão 3'])], // único, mas o Neon tem o mesmo SHA em outra pessoa
  [4, 68, A, pdf(['Comprovante de baixa no eSocial', 'Carteira de trabalho digital', `CPF ${A}`, 'arquivo próprio'])], // único: pronto
  [5, 64, null, pdf(['Certificado de Regularidade do FGTS - CRF', 'Empresa exemplo', 'Validade 30/11/2026'])], // empresa: pode repetir
  [6, 64, null, pdf(['Certificado de Regularidade do FGTS - CRF', 'Empresa exemplo', 'Validade 30/11/2026'])],
];
const crypto = require('crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sid = (i) => `0000000${i}-0000-0000-0000-000000000000`;
const db = new DatabaseSync(path.join(OUT, 'atlas.db'));
db.exec(`CREATE TABLE coletas (id INTEGER PRIMARY KEY);
  CREATE TABLE pendencias (coleta_id INT, aba TEXT, status TEXT, documento TEXT, cpf TEXT, cnpj_filial TEXT, pedido TEXT, unidades TEXT, competencia TEXT, prazo_envio TEXT, document_schedule_id TEXT);
  INSERT INTO coletas VALUES (1);`);
for (const [i, , c, buf] of CASOS) {
  db.prepare(`INSERT INTO pendencias VALUES (1, 'Atrasados', 'DelayNotSent', ?, ?, '1', NULL, 'U', '08/2026', '2026-09-10', ?)`).run(`Doc ${i}`, c, sid(i));
  fs.writeFileSync(path.join(OUT, 'downloads', 'sharepoint', `IT${i}.pdf`), buf);
}
db.close();
fs.writeFileSync(path.join(OUT, 'envio', 'modo.json'), JSON.stringify({ liberado: true, automatico: true }));
fs.writeFileSync(path.join(D, 'neon.js'), `exports.conexao = () => 'postgres://falso';`);
fs.writeFileSync(path.join(D, 'comum.js'), `
const path = require('path');
exports.APP = 'https://app'; exports.GATEWAY = 'https://gw/'; exports.OUT = path.join(__dirname, 'out');
exports.log = (m) => console.log(m); exports.dormir = async () => {};
exports.abrir = async () => ({ ctx: { token: 't', close: async () => {} }, page: {} });
exports.garantirLogin = async () => {}; exports.esperarToken = async () => {};
exports.api = async (ctx, url) => { const i = Number(url.match(/0000000(\\d)-/)[1]); return { name: 'Doc ' + i, status: 'Delay', type_upload: 'ManualByProvider', file_format: ['PDF'] }; };
`);
const linhas = CASOS.map(([i, doc, c]) => ({ id: i, doc_id: doc, nome: 'Doc ' + i, competencia: '08/2026', estado: 'LOCALIZADO', caminho_origem: 'sharepoint:IT' + i,
  unidade: 'U', cnpj_filial: '1', prazo_envio: '2026-09-10', cpf: c, numero_pedido: null, hash_arquivo: null, tamanho_bytes: null }));
// No Neon, uma pendência antiga (#9, outra pessoa) já tem o mesmo arquivo do #3.
const comHash = [{ id: 9, cpf: A, hash_arquivo: sha(CASOS[2][3]) }];
fs.writeFileSync(path.join(D, 'falsos.js'), `
const Module = require('module'); const orig = Module._load;
const linhas = ${JSON.stringify(linhas)}; const comHash = ${JSON.stringify(comHash)};
Module._load = function (req, ...r) {
  if (req === '@neondatabase/serverless') return { neon: () => ({ query: async (q, p) => /^\\s*update/i.test(q) ? [] : /hash_arquivo is not null/.test(q) ? comHash : /id = \\$2/.test(q) ? linhas.filter((l) => l.id === p[1]) : linhas }) };
  return orig.call(this, req, ...r);
};
global.fetch = async () => ({ ok: true, status: 200, text: async () => '{}' });
`);

const rodar = (...a) => { try { return execFileSync(process.execPath, ['-r', path.join(D, 'falsos.js'), path.join(D, 'enviar.js'), ...a], { cwd: D, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); } };
let ok = 0, falhou = 0;
const t = (nome, cond) => { if (cond) ok++; else falhou++; console.log((cond ? 'ok    ' : 'FALHOU') + ' ' + nome); };

rodar();
const it = JSON.parse(fs.readFileSync(path.join(OUT, 'enviar-simulacao.json'), 'utf8')).itens;
const p = (i) => it.find((x) => x.id === i);
const mesmo = (i) => p(i).motivos.some((m) => /mesmo arquivo está na pendência de outro funcionário/.test(m));
t('#1 e #2 (mesmo arquivo, pessoas diferentes): nenhum fica pronto', !p(1).pronta && !p(2).pronta && mesmo(1) && mesmo(2));
t('#3 (o Neon já tem o mesmo arquivo em outra pessoa): não fica pronto', !p(3).pronta && mesmo(3));
t('#4 (arquivo só dela, CPF dela no texto): pronto, confiança alta', p(4).pronta && p(4).conteudo?.confianca === 'alta');
t('#5 e #6 (documento de empresa repetido): podem sair', p(5).pronta && p(6).pronta);
t('conteúdo foi lido em todos', it.every((x) => x.conteudo?.lido === true));
t('o resultado não grava CPF', !JSON.stringify(it.map((x) => x.conteudo)).includes(A));

rodar('--auto');
const res = JSON.parse(fs.readFileSync(path.join(OUT, 'envio', 'resultados.json'), 'utf8'));
t('envio automático: só #4, #5 e #6 saem', Object.keys(res).sort().join() === '4,5,6');
rodar('--enviar', '--id', '1', '--confirmo', sid(1));
const r1 = JSON.parse(fs.readFileSync(path.join(OUT, 'envio', 'resultados.json'), 'utf8'))[1];
t('envio manual do #1 é recusado antes do upload', r1 && !r1.ok && /não está pronta: .*mesmo arquivo/.test(r1.msg));

fs.rmSync(D, { recursive: true, force: true });
console.log(`\n${ok} ok, ${falhou} falhou`);
process.exitCode = falhou ? 1 : 0;
