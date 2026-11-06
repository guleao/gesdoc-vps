// Teste (03/11): achar a pasta e o arquivo pelas PALAVRAS do nome (sharepoint.js e factorial.js), sem exigir o nome exato.
// Uso: node teste/t-achar-arquivo.js
const path = require('path');
const sp = require(path.join(__dirname, '..', 'atlas-robo', 'sharepoint'));
const fa = require(path.join(__dirname, '..', 'atlas-robo', 'factorial'));
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };
const n = sp.normalizar;

// ---- SharePoint: pasta do tipo dentro do mês
const pasta = (doc, nome) => sp.REGRAS[doc].tipo.test(n(nome));
for (const [doc, nome] of [[2, 'V.A'], [2, 'VA'], [2, 'V A'], [2, 'Vale Alimentação'], [2, 'VALE-ALIMENTACAO 08'], [3, 'V.T'], [3, 'Vale Transporte'], [3, 'VT 2026'],
  [4, 'seguro'], [4, 'Seguro de Vida'], [4, 'SEGUROS'], [7, 'plano saúde'], [7, 'PLANO SAUDE'], [7, 'Plano de Saúde'],
  [24, 'FGTS'], [24, 'FGTS Digital'], [25, 'fgts 08.2026'], [26, 'FGTS'], [60, 'INSS'], [60, 'INSS - DCTFWeb'], [61, 'Inss'], [65, 'INSS'], [59, 'INSS'],
  [63, 'FOPAG'], [63, 'Fopag - Folha de Pagamento'], [63, 'Folha de Pagamento']]) t(pasta(doc, nome), `pasta ${doc} "${nome}" devia casar`);
for (const [doc, nome] of [[2, 'Valor total'], [2, 'Nova a'], [4, 'plano de saude'], [24, 'INSS'], [60, 'FGTS'], [3, 'V.A'], [7, 'seguro']]) t(!pasta(doc, nome), `pasta ${doc} "${nome}" NÃO devia casar`);

// ---- escolherPasta: várias casam
const P = (...nomes) => nomes.map((name) => ({ name, folder: {} }));
let e = sp.escolherPasta(P('FGTS', 'INSS', 'FOPAG'), sp.REGRAS[24].tipo); t(e.pasta?.name === 'FGTS' && !e.aviso, 'uma pasta casa');
e = sp.escolherPasta(P('FGTS', 'FGTS rescisoria'), sp.REGRAS[24].tipo); t(e.pasta?.name === 'FGTS' && /mais curto/.test(e.aviso), 'mais curta vence e avisa');
e = sp.escolherPasta(P('FGTS 1', 'FGTS 2'), sp.REGRAS[24].tipo); t(e.pasta === null && e.n === 2, 'empate = não escolhe');
e = sp.escolherPasta(P('INSS'), sp.REGRAS[24].tipo); t(e.pasta === null && e.n === 0, 'nenhuma casa');

// ---- SharePoint: arquivo
const arq = (doc, nome) => sp.REGRAS[doc].achar(n(nome));
for (const [doc, nome] of [
  [24, 'Guia FGTS 08-2026.pdf'], [24, 'GFD 08.2026.pdf'], [24, 'Boleto FGTS.pdf'], [25, 'RE 08-2026.pdf'], [25, 'Relação de Empregados 08.pdf'], [26, 'Comprovante FGTS.pdf'], [26, 'Comprovante pagamento.pdf'],
  [60, 'Recibo DCTFWeb 08.pdf'], [60, 'Recibo de entrega DCTF Web.pdf'], [61, 'Declaração completa DCTFWeb.pdf'], [61, 'Relatório completo DCTFWeb.pdf'], [61, 'Relatório da declaração.pdf'],
  [65, 'DARF 1708.pdf'], [65, 'GUIAS DARFS.pdf'], [59, 'DARF - COMPROVANTE.pdf'], [59, 'Comprovante DARF.pdf'],
  [63, 'FOPAG 07.2026 20102080 COMPANHIA DE ELETRICIDADE DO AM.pdf'], [63, 'Extrato mensal.pdf'], [63, 'Extrato da folha.pdf'], [63, 'Folha de pagamento mensal analítica.pdf'],
  [64, 'CERTIDÃO DE REGULARIDADE FGTS - 01.06.2026.pdf'], [64, 'CRF - 27-10-2026.pdf'], [64, 'Certificado de Regularidade do FGTS.pdf'], [64, 'CND do FGTS.pdf'],
  [81, 'Certidão Negativa de Débitos Relativos aos Tributos Federais - 05-04-2027.pdf'], [81, 'CND Federal.pdf'], [81, 'Certidão Positiva com Efeitos de Negativa - Receita Federal.pdf'],
  [82, 'CNDT 2026.pdf'], [82, 'Certidão Negativa de Débitos Trabalhistas.pdf']]) t(arq(doc, nome), `arquivo ${doc} "${nome}" devia casar`);
for (const [doc, nome] of [[24, 'Comprovante FGTS.pdf'], [24, 'RE 08.pdf'], [60, 'Declaração completa.pdf'], [61, 'Recibo DCTFWeb.pdf'], [65, 'DARF comprovante.pdf'], [59, 'DCTFWEB + DARF + COMPROVANTE.pdf'],
  [81, 'CND FGTS.pdf'], [81, 'Certidão Negativa Trabalhista.pdf'], [64, 'CND Federal.pdf'], [82, 'CRF.pdf']]) t(!arq(doc, nome), `arquivo ${doc} "${nome}" NÃO devia casar`);

// ---- Benefícios: papel do arquivo
const papel = (nome) => sp.papelBeneficio(nome).papel;
for (const [nome, esperado] of [['Relação de Beneficiários.pdf', 'relacao'], ['Lista de colaboradores.pdf', 'relacao'], ['Listagem de beneficiários.pdf', 'relacao'], ['Relatório-de-pedidos mob 80.pdf', 'relacao'],
  ['Boleto.pdf', 'boleto'], ['Boleto Santander.pdf', 'boleto'], ['Cobrança 08.pdf', 'boleto'], ['Projeto_2010008001_08-2026.pdf', 'boleto'],
  ['Comprovante 1.344,00.pdf', 'comprovante'], ['Comprovante de pagamento.pdf', 'comprovante'], ['Recibo de pagamento.pdf', 'comprovante'], ['Pix.pdf', 'comprovante'], ['comp80.pdf', 'comprovante'],
  ['NF 123.pdf', 'nf'], ['Nota fiscal.pdf', 'nf'], ['Relação de Beneficiários + Boleto + Comprovante.pdf', 'pronto'], ['Capa.pdf', 'outro']]) t(papel(nome) === esperado, `papel "${nome}": esperado ${esperado}, obtido ${papel(nome)}`);

// ---- Factorial 67/68/69
const fp = (doc, nome) => fa.REGRAS[doc].pastas.test(fa.normalizar(nome));
const fc = (doc, nome) => fa.REGRAS[doc].achar(fa.normalizar(nome));
for (const [doc, nome] of [[67, 'BR-ASO'], [67, 'BR ASO'], [67, 'Offboarding'], [67, 'Offboard'], [68, 'Offboarding'], [68, 'OFFBOARD'], [69, 'Offboarding']]) t(fp(doc, nome), `pasta Factorial ${doc} "${nome}" devia casar`);
for (const [doc, nome] of [[68, 'Onboarding'], [69, 'Documentos pessoais'], [67, 'Onboarding']]) t(!fp(doc, nome), `pasta Factorial ${doc} "${nome}" NÃO devia casar`);
for (const [doc, nome] of [[67, 'ASO Demissional - Fulano.pdf'], [67, 'aso_demissional.pdf'], [67, 'Atestado de Saúde Ocupacional demissional.pdf'], [67, 'ASO - demissão.pdf'],
  [68, 'eSocial.pdf'], [68, 'e-Social baixa.pdf'], [68, 'Baixa CTPS.pdf'], [68, 'Baixa da carteira de trabalho.pdf'],
  [69, 'Pedido de demissão.pdf'], [69, 'pedido_de_desligamento.pdf'], [69, 'Carta de desligamento.pdf'], [69, 'Solicitação de demissão.pdf']]) t(fc(doc, nome), `arquivo Factorial ${doc} "${nome}" devia casar`);
for (const [doc, nome] of [[67, 'ASO admissional.pdf'], [67, 'Exame.pdf'], [68, 'Pedido de demissão.pdf'], [69, 'Aviso prévio.pdf'], [69, 'eSocial.pdf']]) t(!fc(doc, nome), `arquivo Factorial ${doc} "${nome}" NÃO devia casar`);

console.log(`${ok} ok, ${falhou} falhou`);
process.exitCode = falhou ? 1 : 0;
