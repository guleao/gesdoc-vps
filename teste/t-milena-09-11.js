// Teste (09/11): respostas da Milena de 06/11 + e-mail de 29/10 (benefícios só na pasta do DP), com nomes REAIS das pastas novas.
// Uso: node teste/t-milena-09-11.js   (CHROME_PATH opcional para testar também a declaração do VR com um modelo de teste)
const path = require('path');
const sp = require(path.join(__dirname, '..', 'atlas-robo', 'sharepoint'));
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };
const n = sp.normalizar;
const papel = (nome) => sp.papelBeneficio(nome).papel;

// ---- pasta do projeto 80 (V.A e V.T) e apólice do seguro
for (const nome of ['PROJETO 2010008001', '20102080 ', '20102080', 'Proj 80']) t(sp.PROJETO_80.test(n(nome)), `projeto 80: "${nome}" devia casar`);
for (const nome of ['PROJETO 2010008300', 'Proj 83', '20102089', 'PROJETO 2010008001 antigo', 'Proj 800']) t(!sp.PROJETO_80.test(n(nome)), `projeto 80: "${nome}" NÃO devia casar`);
const seg = sp.BENEFICIO_DP[4].alvo;
for (const nome of ['NIP GRUPO AP I', 'GRUPO AP I']) t(seg.test(n(nome)), `seguro: "${nome}" devia casar`);
for (const nome of ['NIP GRUPO AP II', 'Grupo AP III', 'NIP GRUPO VG', 'GRUPO VG WS96167']) t(!seg.test(n(nome)), `seguro: "${nome}" NÃO devia casar`);

// ---- mês das pastas novas
for (const [nome, m] of [['09 - Setembro', 9], ['11 - Novembro', 11], ['09. SETEMBRO', 9], ['05 maio', 5], ['07-JULHO', 7], ['10 - OUTUBRO', 10], ['01. JANEIRO', 1]]) t(sp.mesDaPasta(nome) === m, `mês "${nome}" = ${m}`);

// ---- papéis dos arquivos reais
const casos = [
  // V.A 09/2026, projeto 80
  ['comprovante 80.pdf', 'comprovante'], ['Projeto_2010008001_09-2026.pdf', 'boleto'], ['Relatório de Resumo de Pedido 80.pdf', 'relacao'],
  // V.A 11/2026: a declaração do VR fica na mesma pasta e NÃO entra
  ['Declaração MODELO - VR - Equatorial.pdf', 'declaracao'],
  // V.T 09/2026
  ['comprovante mob 80.pdf', 'comprovante'], ['Mob2010008001_09-2026.pdf', 'boleto'], ['Relatório de Resumo de Pedido mob 80.pdf', 'relacao'],
  // Seguro 07/2026 e 06/2026 (NIP GRUPO AP I): o aditamento fica de fora
  ['Comprovante_15102026143919.pdf', 'comprovante'], ['Faturamento_9728694_4987010_NIP GRUPO AP I_BOLETO_07.26_PRUDENTIAL.pdf', 'boleto'],
  ['Faturamento_9728694_4987011_NIP GRUPO AP I_ADITAMENTO_07.26_PRUDENTIAL.pdf', 'aditamento'], ['Faturamento_9728694_4987012_NIP GRUPO AP I_VIDAS_07.26_PRUDENTIAL.pdf', 'relacao'],
  ['comprovante 2.328,66.pdf', 'comprovante'], ['NIP GRUPO AP I_ADITAMENTO_06.26_PRUDENTIAL.pdf', 'aditamento'], ['NIP GRUPO AP I_BOLETO_06.26_PRUDENTIAL.pdf', 'boleto'],
  ['NIP GRUPO AP I_VIDAS_06.26_PRUDENTIAL.pdf', 'relacao'],
];
for (const [nome, p] of casos) t(papel(nome) === p, `"${nome}" devia ser ${p} (deu ${papel(nome)})`);

// ---- montagem completa: seguro 07/2026 fecha sem o aditamento; V.A 11/2026 fecha sem a declaração
const F = (...nomes) => nomes.map((name, i) => ({ name, id: 'x' + i, size: 1 }));
let r = sp.partesBeneficio(F('Comprovante_15102026143919.pdf', 'Faturamento_9728694_4987010_NIP GRUPO AP I_BOLETO_07.26_PRUDENTIAL.pdf',
  'Faturamento_9728694_4987011_NIP GRUPO AP I_ADITAMENTO_07.26_PRUDENTIAL.pdf', 'Faturamento_9728694_4987012_NIP GRUPO AP I_VIDAS_07.26_PRUDENTIAL.pdf'));
t(!r.erro && r.itens.map((x) => x.papel).join(',') === 'relacao,boleto,comprovante', `seguro 07/2026 monta relação→boleto→comprovante (${r.erro || r.itens.map((x) => x.papel)})`);
t((r.deixados || []).some((d) => /aditamento/.test(d.motivo)), 'seguro: aditamento listado como deixado de fora');
r = sp.partesBeneficio(F('comprovante.pdf', 'Declaração MODELO - VR - Equatorial.pdf', 'Projeto_2010008001_11-2026.pdf', 'Relatório de Resumo de Pedido 80.pdf'));
t(!r.erro && r.itens.length === 3, `V.A 11/2026 monta sem a declaração (${r.erro || r.itens.length})`);
t((r.deixados || []).some((d) => /doc 6/.test(d.motivo)), 'V.A: declaração listada como deixada de fora');
// aditamento sozinho não esconde falta de parte
r = sp.partesBeneficio(F('NIP GRUPO AP I_ADITAMENTO_06.26_PRUDENTIAL.pdf', 'NIP GRUPO AP I_BOLETO_06.26_PRUDENTIAL.pdf'));
t(!!r.erro && /falta relação/.test(r.erro), `sem relação continua travando (${r.erro})`);

// ---- regra do doc 6 e DCTFWeb na FOPAG
t(sp.REGRAS[6] && sp.REGRAS[6].raiz === 'declaracao', 'doc 6 tem regra (declaração)');
t(sp.REGRAS[6].achar(n('Declaração MODELO - VR - Equatorial.pdf')), 'doc 6 acha o modelo');
t(!sp.REGRAS[6].achar(n('Relatório de Resumo de Pedido 80.pdf')), 'doc 6 não pega a relação do V.A');
t(sp.REGRAS[60].fopag && sp.REGRAS[61].fopag && !sp.REGRAS[25].fopag && !sp.REGRAS[24].fopag, 'reserva FOPAG só no 60 e 61');
t(sp.REGRAS[60].achar(n('Recibo de Entrega da Declaração de Débitos e Créditos Tributários Federais - DCTFWeb - 09.2026.pdf')), '60 acha o recibo da FOPAG');
t(sp.REGRAS[61].achar(n('RELATÓRIO DA DECLARAÇÃO COMPLETA - DCTFWeb - 09.2026.pdf')), '61 acha o relatório da FOPAG');
t(!sp.REGRAS[61].achar(n('Recibo de Entrega da Declaração de Débitos e Créditos Tributários Federais - DCTFWeb - 09.2026.pdf')), '61 não pega o recibo');
t(/EDP/.test(sp.FORA_ESCE), 'motivo da ESCE cita EDP');

(async () => {
  // ---- declaração do VR com um modelo de teste (só se houver Chromium): troca só a linha da data
  const { gerarDeclaracaoVR, dataPorExtenso } = require(path.join(__dirname, '..', 'atlas-robo', 'declaracao-vr'));
  t(dataPorExtenso(new Date(2026, 10, 9)) === '09 de novembro de 2026', 'data por extenso');
  t(dataPorExtenso(new Date(2026, 2, 1)) === '01 de março de 2026', 'data por extenso com acento');
  const modelo = process.env.MODELO_VR;
  if (modelo) {
    const g = await gerarDeclaracaoVR(require('fs').readFileSync(modelo), new Date(2026, 10, 9));
    t(!g.erro && /09 de novembro de 2026\.$/.test(g.depois) && /^Vitória, /.test(g.depois), `declaração gerada (${g.erro || g.depois})`);
    t(!g.erro && g.buf.subarray(0, 5).toString() === '%PDF-', 'declaração é PDF');
    const ruim = await gerarDeclaracaoVR(Buffer.from('nao e pdf'));
    t(!!ruim.erro, 'modelo que não é PDF dá erro');
  } else console.log('(declaração do VR: defina MODELO_VR=<pdf> e CHROME_PATH para testar a geração)');
  console.log(`${ok} ok, ${falhou} falhou`);
  process.exitCode = falhou ? 1 : 0;
})();
