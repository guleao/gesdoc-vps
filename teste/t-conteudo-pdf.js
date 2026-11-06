// Teste da leitura do conteúdo do PDF (29/10): ler-pdf.js, a regra do Atlas (atlas-robo/conteudo.js) e a esteira
// Bernhoeft (painel/auto.js: contrato divergente e confiança pelo texto). Os PDFs são gerados aqui, com dados inventados.
// Rodar: node teste/t-conteudo-pdf.js   (sem rede, sem Neon, sem portal)
const fs = require('fs');
const os = require('os');
const path = require('path');
const RAIZ = path.join(__dirname, '..');
const lerPdf = require(path.join(RAIZ, 'atlas-robo', 'ler-pdf.js'));
const { conferirConteudo } = require(path.join(RAIZ, 'atlas-robo', 'conteudo.js'));
const auto = require(path.join(RAIZ, 'bernhoeft-robo', 'deploy', 'gesdoc', 'services', 'painel', 'auto.js'));

// PDF de uma página com as linhas dadas (Helvetica, texto de verdade, como um PDF exportado). vazio = página sem texto (como imagem).
function pdf(linhas) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => '\\' + m);
  const conteudo = linhas.length ? 'BT /F1 11 Tf 50 780 Td 14 TL ' + linhas.map((l) => `(${esc(l)}) Tj T*`).join(' ') + ' ET' : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(conteudo, 'latin1')} >>\nstream\n${conteudo}\nendstream`,
  ];
  let s = '%PDF-1.4\n';
  const pos = [];
  objs.forEach((o, i) => { pos.push(Buffer.byteLength(s, 'latin1')); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

// CPF válido inventado a partir de 9 dígitos.
function cpf(base) {
  const d = base.split('').map(Number);
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += d[i] * (t + 1 - i);
    d.push(((s * 10) % 11) % 10);
  }
  return d.join('');
}
const CPF_A = cpf('123456789');
const CPF_B = cpf('987654321');
const fmt = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 't-conteudo-'));
const arq = (nome, linhas) => { const f = path.join(DIR, nome); fs.writeFileSync(f, pdf(linhas)); return f; };

let ok = 0, falhas = 0;
const confere = (nome, cond) => { if (cond) ok++; else falhas++; console.log(`${cond ? 'ok   ' : 'FALHA'} ${nome}`); };

(async () => {
  // ---------- ler-pdf.js ----------
  const copia = fs.readFileSync(path.join(RAIZ, 'bernhoeft-robo', 'deploy', 'gesdoc', 'services', 'painel', 'ler-pdf.js'), 'utf8').split('\n').slice(1).join('\n');
  confere('a cópia do painel é igual à fonte (atlas-robo/ler-pdf.js)', copia === fs.readFileSync(path.join(RAIZ, 'atlas-robo', 'ler-pdf.js'), 'utf8'));
  const l1 = await lerPdf.lerTexto(arq('trct.pdf', ['TERMO DE RESCISÃO DO CONTRATO DE TRABALHO', `Empregado: Fulano de Tal  CPF ${fmt(CPF_A)}`, 'Competência 07/2026', 'Valor líquido a receber']));
  confere('lê o texto de um PDF com texto', l1.temTexto && l1.paginas === 1);
  confere('acentos e maiúsculas não atrapalham ("RESCISÃO" casa com "rescisao")', lerPdf.casaGrupos(l1.texto, [['rescisao']]).length === 1);
  confere('acha o CPF válido no texto', lerPdf.cpfsNoTexto(l1.texto).includes(CPF_A));
  confere('cita a competência 07/2026', lerPdf.citaCompetencia(l1.texto, '07/2026') === true);
  confere('não cita 08/2026', lerPdf.citaCompetencia(l1.texto, '08/2026') === false);
  const l2 = await lerPdf.lerTexto(arq('julho.pdf', ['Relação de beneficiários referente a julho de 2026', 'Vale transporte']));
  confere('competência por extenso ("julho de 2026")', lerPdf.citaCompetencia(l2.texto, '07/2026') === true);
  confere('palavra inteira: "caso" não casa com "aso"', lerPdf.casaGrupos(lerPdf.normalizar('neste caso o exame'), [['aso']]).length === 0);
  confere('prefixo: "ergonom*" casa com "ergonômica"', lerPdf.casaGrupos(lerPdf.normalizar('Análise Ergonômica'), [['ergonom*']]).length === 1);
  const vazio = await lerPdf.lerTexto(arq('imagem.pdf', []));
  confere('PDF sem texto (imagem) é reconhecido', vazio.temTexto === false);
  confere('número curto sem ano não vira contrato ("Rua 356")', lerPdf.contratosNoTexto(lerPdf.normalizar('Rua 356, sala 2'), ['356/2026']).length === 0);
  confere('número curto com ano vira contrato ("356/2026")', lerPdf.contratosNoTexto(lerPdf.normalizar('Contrato 356/2026 - MA'), ['356/2026']).includes('356'));
  confere('contrato longo com zeros e sem ano ("4600029823")', lerPdf.contratosNoTexto(lerPdf.normalizar('CT 4600029823'), ['4600029823/2024']).includes('4600029823'));
  confere('PDF quebrado volta com erro, sem derrubar', Boolean((await lerPdf.lerTexto(Buffer.from('não é pdf'))).erro));

  // ---------- Atlas (conteudo.js) ----------
  const linha = (doc_id, nome, extra = {}) => ({ doc_id, nome, cpf: CPF_A, competencia: '07/2026', ...extra });
  let c = await conferirConteudo(arq('a1.pdf', ['TERMO DE RESCISÃO DO CONTRATO DE TRABALHO', `CPF ${fmt(CPF_A)}`]), linha(9, 'TRCT'));
  confere('Atlas: TRCT certo, com o CPF da pendência = confiança alta, não bloqueia', c.confianca === 'alta' && !c.bloqueio);
  c = await conferirConteudo(arq('a2.pdf', ['TERMO DE RESCISÃO DO CONTRATO DE TRABALHO', `CPF ${fmt(CPF_B)}`]), linha(9, 'TRCT'));
  confere('Atlas: PDF com o CPF de OUTRA pessoa = bloqueia', /outra pessoa/.test(c.bloqueio || ''));
  c = await conferirConteudo(arq('a3.pdf', ['ATESTADO DE SAÚDE OCUPACIONAL', `CPF ${fmt(CPF_A)}`, 'ANAMNESE', 'Antecedentes pessoais: ...']), linha(67, 'ASO'));
  confere('Atlas: ASO com anamnese (LGPD) = bloqueia', /não pode ir/.test(c.bloqueio || ''));
  c = await conferirConteudo(arq('a4.pdf', ['AVISO PRÉVIO DO EMPREGADOR', 'Comunicamos que a partir desta data...', `CPF ${fmt(CPF_A)}`]), linha(69, 'Pedido de demissão'));
  confere('Atlas: doc 69 que é aviso prévio do empregador = bloqueia', /outro documento/.test(c.bloqueio || ''));
  c = await conferirConteudo(arq('a5.pdf', ['PEDIDO DE DEMISSÃO', 'Venho por meio desta pedir demissão do cargo', `CPF ${fmt(CPF_A)}`]), linha(69, 'Pedido de demissão'));
  confere('Atlas: pedido de demissão de verdade = passa', !c.bloqueio && c.confianca === 'alta');
  c = await conferirConteudo(arq('a6.pdf', ['Nota fiscal de serviço eletrônica', 'Prestador: Empresa Exemplo Ltda', 'Valor total dos serviços']), linha(9, 'TRCT', { cpf: null }));
  confere('Atlas: texto sem nenhuma palavra do tipo = bloqueia', /nenhuma palavra-chave/.test(c.bloqueio || ''));
  c = await conferirConteudo(arq('a7.pdf', []), linha(9, 'TRCT'));
  confere('Atlas: PDF só imagem = não bloqueia, confiança média', !c.bloqueio && c.confianca === 'media' && c.lido === false);
  c = await conferirConteudo(arq('a8.pdf', ['Relação de beneficiários - Vale Transporte', 'julho de 2026']), linha(3, 'VT', { cpf: null }));
  confere('Atlas: VT do mês certo = passa e cita a competência', !c.bloqueio && c.competencia === true);
  confere('Atlas: o resultado nunca leva o CPF', !JSON.stringify(c).includes(CPF_A));

  // ---------- Bernhoeft (auto.js) ----------
  const pend = { contrato: '356/2026 - MA', descricao: 'Brigada de Incêndio' };
  const doc = (filename) => ({ id: filename, filename, created_at: '2026-10-01', signature_status: null });
  let esc = auto.escolher(pend, [doc('Brigada MA 4600029823.pdf')], [pend]);
  confere('Bernhoeft: nome cita outro contrato da Equatorial (que nem está pendente) = fora', esc.usar.length === 0);
  esc = auto.escolher(pend, [doc('Brigada CT 757-2025.pdf')], [pend]);
  confere('Bernhoeft: número curto de outro contrato com ano no nome = fora', esc.usar.length === 0);
  esc = auto.escolher(pend, [doc('Brigada MA.pdf')], [pend]);
  confere('Bernhoeft: nome só com o estado = média', esc.usar.length === 1 && esc.confianca === 'média');

  const parte = (nome, linhas) => ({ a: { filename: nome }, buf: pdf(linhas) });
  let r = await auto.conferirConteudo(pend, 'Brigada de Incêndio', [parte('brigada.pdf', ['Relação da Brigada de Incêndio', 'Contrato 4600029823/2024 - MA'])], 2);
  confere('Bernhoeft: texto cita outro contrato e não o da pendência = parte tirada (caso da ficha 16)', r.manter.length === 0 && r.tirados.length === 1);
  r = await auto.conferirConteudo(pend, 'Brigada de Incêndio', [parte('brigada.pdf', ['Relação da Brigada de Incêndio', 'Contrato 356/2026 - MA'])], 2);
  confere('Bernhoeft: texto cita o contrato da pendência e o tipo = alta', r.manter.length === 1 && r.nivel === 3);
  const avcb = { contrato: '00223/2025 - PA', descricao: 'Projeto de Prevenção e Combate a Incêndio e AVCB' };
  r = await auto.conferirConteudo(avcb, 'Projeto de Prevenção e Combate a Incêndio e AVCB', [parte('plano.pdf', ['DECLARAÇÃO DE NÃO APLICABILIDADE', 'Plano de Emergência', 'CT 00223/2025'])], 3);
  confere('Bernhoeft: declaração de não aplicabilidade no lugar do AVCB = baixa (caso da ficha 15)', r.nivel === 1);
  r = await auto.conferirConteudo(avcb, 'Projeto de Prevenção e Combate a Incêndio e AVCB', [parte('avcb.pdf', ['AUTO DE VISTORIA DO CORPO DE BOMBEIROS', 'Projeto de prevenção e combate a incêndio'])], 2);
  confere('Bernhoeft: AVCB de verdade = sobe a confiança', r.nivel === 3);
  r = await auto.conferirConteudo(pend, 'Brigada de Incêndio', [parte('rel.pdf', ['Relação da Brigada de Incêndio', 'Contrato 4600029823/2024 - MA']), parte('cal.pdf', ['Calendário de reuniões da brigada de incêndio do ano'])], 2);
  confere('Bernhoeft: um arquivo do grupo era de outro contrato = os que ficam vão para baixa', r.manter.length === 1 && r.nivel === 1);
  r = await auto.conferirConteudo(pend, 'Brigada de Incêndio', [parte('img.pdf', [])], 2);
  confere('Bernhoeft: PDF só imagem = mantém e não muda a confiança', r.manter.length === 1 && r.nivel === 2);

  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${ok} de ${ok + falhas} ok`);
  process.exitCode = falhas ? 1 : 0;
})();
