// 06/11: separar GFD rescisória (10) × guia mensal (24) × RE (25) e recibo (60) × relatório (61) da DCTFWeb.
// Trechos tirados dos PDFs reais da VPS (dígitos de CPF trocados). Rodar: node teste/t-gfd-dctf.js
const path = require('path');
const { tipoGfd, CONTEUDO } = require(path.join(__dirname, '..', 'atlas-robo', 'conteudo'));
const lerPdf = require(path.join(__dirname, '..', 'atlas-robo', 'ler-pdf'));
let ok = 0, falhou = 0;
const t = (c, m) => { if (c) ok++; else { falhou++; console.log('FALHOU:', m); } };

const RESC = 'gfd - guia do fgts digital composicao do documento competencia quantidade trabalhadores fgts mensal fgts rescisorio indenizacao compensatoria encargos fgts total 1.677,93 0,00 0,00 669,94 1.007,99 07/2026 1 total fgts: 1.677,93 0,00 0,00 669,94 1.007,99 informacoes de recolhimentos';
const RESC2 = 'total fgts: 6.907,07 0,00 399,18 679,25 5.828,64 informacoes';
const MENSAL = 'gfd - guia do fgts digital quantidade trabalhadores fgts mensal fgts rescisorio indenizacao compensatoria encargos fgts total 287.197,41 89,27 287.108,14 0,00 0,00 09/2026 870 total fgts: 287.197,41 89,27 287.108,14 0,00 0,00 informacoes';
const RE = 'relacao de trabalhadores remuneracao deposito fulano 123456 111.222.333-44 101 01/02/2020 mensal 2.000,00 160,00 0,00 0,00 0,00 160,00 0 beltrano 654321 555.666.777-88 101 03/04/2021 mensal 3.000,00 240,00';
const DETALHE_RESC = 'tipo deposito base remuneracao total valor fgts na guia fulano 12345 111.222.333-44 101 01/02/2020 rescisorio 1.000,00 80,00 0,00 0,00 0,00 80,00 fulano 12345 111.222.333-44 101 01/02/2020 multa rescisoria 1.000,00 400,00 relacao de categorias fgts mensal na guia fgts rescisorio na guia';

t(tipoGfd(RESC).guia === 'rescisoria', 'GFD rescisória pelo total');
t(tipoGfd(RESC2).guia === 'rescisoria', 'rescisória com mês anterior junto');
t(tipoGfd(MENSAL).guia === 'mensal', 'guia mensal (indenização e encargos 0,00)');
t(tipoGfd(RE).re === true && tipoGfd(RE).guia === null, 'RE: só trabalhadores "mensal", sem total da guia');
t(tipoGfd(DETALHE_RESC).re === false, 'detalhamento da rescisória não é RE');
t(tipoGfd(RESC + ' ' + RE).re === false, 'guia + relação juntas: vale a guia');
t(tipoGfd('').guia === null && tipoGfd('').re === false, 'texto vazio não decide');
t(tipoGfd(DETALHE_RESC).resc === true && tipoGfd(RE).resc === false && tipoGfd(RESC).resc === false, 'detalhamento rescisório sem guia = resc');
t(CONTEUDO[10].gfd === 'rescisoria' && CONTEUDO[24].gfd === 'mensal' && CONTEUDO[25].gfd === 're', 'regras 10/24/25');

const RECIBO = 'ministerio da fazenda secretaria especial da receita federal do brasil recibo de entrega da declaracao de debitos e creditos tributarios federais - dctfweb cnpj/cpf periodo de apuracao';
const RELAT = 'ministerio da fazenda secretaria especial da receita federal do brasil relatorio da declaracao completa - dctfweb nome do contribuinte periodo apuracao numero do recibo 123';
const casa = (txt, doc) => ({ tipo: lerPdf.casaGrupos(txt, CONTEUDO[doc].tipo).length > 0, neg: lerPdf.casaGrupos(txt, CONTEUDO[doc].negativos || []).length > 0 });
t(casa(RECIBO, 60).tipo && !casa(RECIBO, 60).neg, 'recibo passa no 60');
t(casa(RELAT, 61).tipo && !casa(RELAT, 61).neg, 'relatório passa no 61');
t(!casa(RELAT, 60).tipo && casa(RELAT, 60).neg, 'relatório barrado no 60');
t(!casa(RECIBO, 61).tipo && casa(RECIBO, 61).neg, 'recibo barrado no 61');

console.log(`${ok} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
