// Teste do classificar.js (03/11): reconhecer o documento do Atlas pelas palavras do nome. Uso: node teste/t-classificar-nome.js
const path = require('path');
const { classificar } = require(path.join(__dirname, '..', 'atlas-robo', 'classificar'));
const { REGRAS } = require(path.join(__dirname, '..', 'atlas-robo', 'neon'));
let ok = 0, falhou = 0;
const confere = (nome, esperado, rotulo) => {
  const c = classificar(nome);
  const obtido = c.doc ?? (c.ambiguo ? `ambiguo(${c.ambiguo.join(',')})` : null);
  const bate = String(obtido) === String(esperado);
  bate ? ok++ : falhou++;
  if (!bate) console.log(`FALHOU ${rotulo || ''} "${nome}": esperado ${esperado}, obtido ${obtido}`);
};

// 1) Regressão: todo nome exato de hoje (neon.js) tem que dar o mesmo doc pelas palavras.
for (const [nome, doc] of Object.entries(REGRAS)) confere(nome, doc, 'exato');

// 2) Variações de nome que o Atlas pode trazer
const VARIACOES = [
  ['Vale Alimentação', 2], ['VALE ALIMENTAÇÃO - Relação de Beneficiários, Boleto e Comprovante', 2], ['Comprovante de Vale-Alimentação', 2], ['V.A. - Relação + Boleto', 2],
  ['Vale Alimentacao (relacao + boleto)', 2],
  ['Vale Transporte - Relação e comprovante', 3], ['VT (Relação de beneficiários + boleto + comprovante)', 3],
  ['Seguro de Vida em Grupo', 4], ['Vale Refeição', 6], ['Plano de Saúde - Relação de Beneficiários', 7],
  ['Aviso de férias', 8], ['Recibo de Férias + Comprovante', 8],
  ['TRCT', 9], ['TRCT assinado', 9], ['Termo de Rescisão do Contrato de Trabalho', 9],
  ['GFD Rescisória', 10], ['Guia do FGTS Digital Rescisória', 10],
  ['FGTS - Guia', 24], ['FGTS Comprovante', 26], ['FGTS - Relação de Empregados (RE)', 25],
  ['Comprovante de pagamento de salários', 56], ['Comprovante Bancário de Salário', 56],
  ['Comprovante de recolhimento (INSS)', 59],
  ['Recibo DCTFWeb', 60], ['Relatório DCTFWeb', 61], ['Folha de Pagamento Mensal Analítica', 63],
  ['Certidão de Regularidade do FGTS', 64], ['CRF - FGTS', 64], ['DARF', 65], ['Relatório de ocorrências', 66],
  ['ASO Demissional', 67], ['Atestado de Saúde Ocupacional Demissional', 67], ['ASO Admissional', 78], ['ASO Periódico', 78],
  ['Baixa de CTPS', 68], ['Baixa na CTPS e/ou eSocial', 68], ['Pedido de Demissão', 69], ['Carta de Desligamento', 69],
  ['Ficha de Registro', 79], ['Comprovante de registro eSocial', 80], ['Registro no e-Social', 80],
  ['CND Federal', 81], ['Certidão Negativa de Débitos Federais', 81], ['CNDT', 82], ['Certidão Negativa de Débitos Trabalhistas', 82],
  ['Cartão de ponto', 83], ['Convenção Coletiva', 84], ['Acordo coletivo de trabalho', 84],
];
for (const [n, d] of VARIACOES) confere(n, d, 'variacao');

// 3) Ambíguo ou desconhecido: NÃO classifica (uma pessoa decide)
confere('Vale Alimentação/Refeição', 'ambiguo(2,6)', 'ambiguo');
confere('Vale Refeição e Alimentação', 'ambiguo(2,6)', 'ambiguo');
confere('Seguro de Saúde', 'ambiguo(4,7)', 'ambiguo');
confere('Documento qualquer', null, 'desconhecido');
// 05/11: item que o Atlas lista mas não é da NIP (pedido errado na origem) fica sem tipo e é pulado, nunca vira outro benefício.
confere('Plano Odontológico (Relação de Beneficiários + Boleto + Comprovante)', null, 'fora-do-escopo');
confere('Valor da guia', null, 'desconhecido'); // "va" não pode casar dentro de "valor"
confere('Vale', null, 'desconhecido');
confere('', null, 'vazio');
confere('Certidão de Regularidade do FGTS ou CND do FGTS', 64, 'certidao');
confere('Comprovante de pagamento do FGTS rescisório', 10, 'fgts-rescisorio'); // FGTS + rescisório = GFD rescisória (10), não o 26

console.log(`${ok} ok, ${falhou} falhou`);
process.exitCode = falhou ? 1 : 0;
