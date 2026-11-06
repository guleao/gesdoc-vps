// Teste (03/11): conferirConteudo com PDFs de verdade (gerados aqui, dados inventados): certidão vencida, recusa no ASO, dado clínico no 78,
// cartão de ponto e VA com conteúdo de refeição. Uso: node teste/t-conteudo-validade-pdf.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { conferirConteudo } = require(path.join(__dirname, '..', 'atlas-robo', 'conteudo.js'));
let ok = 0, falhou = 0;
const t = (c, m) => { c ? ok++ : (falhou++, console.log('FALHOU', m)); };
function pdf(linhas) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m);
  const conteudo = 'BT /F1 11 Tf 50 780 Td 14 TL ' + linhas.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`];
  let s = '%PDF-1.4\n'; const pos = [];
  objs.forEach((o, i) => { pos.push(Buffer.byteLength(s, 'latin1')); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(s + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`, 'latin1');
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvp-'));
const grava = (nome, linhas) => { const a = path.join(dir, nome); fs.writeFileSync(a, pdf(linhas)); return a; };
const br = (dias) => new Date(Date.now() + dias * 864e5).toISOString().slice(0, 10).split('-').reverse().join('/');
const amanha = br(40), ontem = br(-5);

(async () => {
  let c = await conferirConteudo(grava('crf-ok.pdf', ['Certificado de Regularidade do FGTS - CRF', 'Empresa de teste', `Validade: 01/01/2026 a ${amanha}`]), { doc_id: 64, nome: 'CRF' });
  t(!c.bloqueio && c.confianca === 'alta' && c.validade, `CRF válida passa: ${JSON.stringify(c)}`);
  c = await conferirConteudo(grava('crf-vencida.pdf', ['Certificado de Regularidade do FGTS - CRF', `Validade: 01/01/2026 a ${ontem}`]), { doc_id: 64, nome: 'CRF' });
  t(/vencida/.test(c.bloqueio || '') && c.confianca === 'baixa', `CRF vencida bloqueia: ${c.bloqueio}`);
  c = await conferirConteudo(grava('cnd-vencida.pdf', ['Certidao Negativa de Debitos Relativos aos Tributos Federais da Uniao', 'Certidao federal', `Valida ate ${ontem}`]), { doc_id: 81, nome: 'CND Federal' });
  t(/vencida/.test(c.bloqueio || ''), `CND federal vencida bloqueia: ${c.bloqueio}`);
  c = await conferirConteudo(grava('cnd-ok.pdf', ['Certidao Negativa de Debitos Relativos aos Tributos Federais da Uniao', 'Certidao federal', `Valida ate ${amanha}`]), { doc_id: 81, nome: 'CND Federal' });
  t(!c.bloqueio && c.confianca === 'alta', `CND federal válida passa: ${c.bloqueio}`);
  c = await conferirConteudo(grava('cndt-sem-data.pdf', ['Certidao Negativa de Debitos Trabalhistas CNDT', 'Empresa de teste']), { doc_id: 82, nome: 'CNDT' });
  t(!c.bloqueio && c.confianca === 'media' && /validade não encontrada/.test(c.motivo || ''), `CNDT sem data: média, não bloqueia: ${JSON.stringify(c)}`);
  c = await conferirConteudo(grava('aso-recusa.pdf', ['Atestado de Saude Ocupacional - ASO demissional', 'O colaborador recusou a realizacao do exame demissional']), { doc_id: 67, nome: 'ASO demissional' });
  t(/recusa/.test(c.bloqueio || ''), `ASO com recusa bloqueia: ${c.bloqueio}`);
  c = await conferirConteudo(grava('aso-ok.pdf', ['Atestado de Saude Ocupacional - ASO demissional', 'Apto']), { doc_id: 67, nome: 'ASO demissional' });
  t(!c.bloqueio, `ASO normal passa: ${c.bloqueio}`);
  c = await conferirConteudo(grava('aso78-clinico.pdf', ['Atestado de Saude Ocupacional ASO admissional', 'Anamnese ocupacional: antecedentes pessoais']), { doc_id: 78, nome: 'ASO admissional' });
  t(/não pode ir/.test(c.bloqueio || ''), `ASO 78 com anamnese bloqueia: ${c.bloqueio}`);
  c = await conferirConteudo(grava('ponto.pdf', ['Folha do ponto - agosto de 2026', 'Registro de ponto do colaborador']), { doc_id: 83, nome: 'Cartão de ponto', competencia: '08/2026' });
  t(!c.bloqueio, `83 cartão de ponto passa: ${c.bloqueio}`);
  c = await conferirConteudo(grava('va-refeicao.pdf', ['Vale refeicao - relacao de beneficiarios de agosto de 2026']), { doc_id: 2, nome: 'Vale Alimentação', competencia: '08/2026' });
  t(/nenhuma palavra-chave/.test(c.bloqueio || ''), `VA com conteúdo de refeição bloqueia: ${c.bloqueio}`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${ok} ok, ${falhou} falhou`);
  process.exitCode = falhou ? 1 : 0;
})();
