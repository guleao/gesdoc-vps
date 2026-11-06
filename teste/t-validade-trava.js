// Teste (03/11): validade de certidão (64, 81, 82), recusa no ASO (67), trava por documento (59, 63), unidade do 26 e convenção (84).
// Uso: node teste/t-validade-trava.js
const path = require('path');
const ct = require(path.join(__dirname, '..', 'atlas-robo', 'conteudo'));
const sp = require(path.join(__dirname, '..', 'atlas-robo', 'sharepoint'));
const lerPdf = require(path.join(__dirname, '..', 'atlas-robo', 'ler-pdf'));
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };
const HOJE = '2026-11-03';

// ---- validade no texto (normalizado: minúsculo, sem acento)
const v = (txt) => ct.validadeDoTexto(txt, HOJE);
t(v('certificado de regularidade do fgts validade: 27/10/2026 a 25/11/2026').data === '2026-11-25' && v('validade: 27/10/2026 a 25/11/2026').vencida === false, 'CRF: vale a última data (25/11/2026), ainda válida');
t(v('validade: 01/09/2026 a 30/09/2026').vencida === true, 'CRF vencida');
t(v('certidao negativa de debitos relativos aos tributos federais valida ate 05/04/2027').data === '2027-04-05' && !v('valida ate 05/04/2027').vencida, 'CND federal válida');
t(v('valida ate 05/04/2026').vencida === true, 'CND federal vencida');
t(v('cndt data de validade 30/04/2027').data === '2027-04-30', 'CNDT');
t(v('documento sem data nenhuma').data === null && v('documento sem data').vencida === null, 'sem validade no texto');
t(v('emitida em 01/01/2026 ate 02/02/2026').data === null, 'data de emissão não é validade');

// ---- as regras de conteúdo existem para os documentos novos
for (const d of [2, 64, 67, 78, 79, 80, 81, 82, 83]) t(!!ct.CONTEUDO[d], `CONTEUDO tem o doc ${d}`);
t(!lerPdf.casaGrupos('vale refeicao de agosto', ct.CONTEUDO[2].tipo).length, '2 (VA) não aceita mais "refeição"');
t(lerPdf.casaGrupos('vale alimentacao agosto', ct.CONTEUDO[2].tipo).length === 1, '2 (VA) aceita alimentação');
t(['64', '81', '82'].every((d) => ct.CONTEUDO[d].validade), '64, 81 e 82 conferem a validade');

// ---- recusa no ASO demissional
t(lerPdf.casaGrupos('o colaborador recusou a realizacao do exame', ct.CONTEUDO[67].recusa).length > 0, 'ASO: "recusou" é detectado');
t(lerPdf.casaGrupos('termo de recusa de exame demissional', ct.CONTEUDO[67].recusa).length > 0, 'ASO: "recusa de exame"');
t(!lerPdf.casaGrupos('atestado de saude ocupacional apto', ct.CONTEUDO[67].recusa).length, 'ASO normal não é recusa');

// ---- trava por documento
t(/já sobe automático/.test(ct.travaDoDocumento(59, {})) && /automatizado/.test(ct.travaDoDocumento(63, {})), '59 e 63 ficam segurados');
t(ct.travaDoDocumento(59, { ENVIO_DOCS_LIBERADOS: '59' }) === null && ct.travaDoDocumento(63, { ENVIO_DOCS_LIBERADOS: '59' }) !== null, 'liberar o 59 não libera o 63');
t(ct.travaDoDocumento(63, { ENVIO_DOCS_LIBERADOS: '59, 63' }) === null, 'liberar os dois');
t(ct.travaDoDocumento(2, {}) === null && ct.travaDoDocumento(67, {}) === null, 'outros documentos não têm trava');

// ---- SharePoint: regras novas
t(sp.REGRAS[82].achar(sp.normalizar('CNDT 2026.pdf')) && !sp.REGRAS[82].achar(sp.normalizar('CND Federal.pdf')), '82 CNDT');
t(sp.REGRAS[84].raiz === 'convencoes' && sp.REGRAS[84].achar(sp.normalizar('Convenção Coletiva 2026.pdf')) && sp.REGRAS[84].achar(sp.normalizar('ACT 2025-2026.pdf')), '84 convenção');

// ---- 26: comprovante sem unidade no título
const A = (...nomes) => nomes.map((name) => ({ name }));
let f = sp.filtrarPorUnidade(A('Comprovante FGTS.pdf'), 'Equatorial Maranhão');
t(f.cand.length === 1 && /serve a todas/.test(f.aviso), '26: sem unidade no nome serve a todas, com aviso');
f = sp.filtrarPorUnidade(A('Comprovante FGTS Maranhão.pdf', 'Comprovante FGTS Piauí.pdf'), 'Equatorial Piauí');
t(f.cand.length === 1 && /Piau/.test(f.cand[0].name) && !f.aviso, '26: dois arquivos, vale o da unidade');
f = sp.filtrarPorUnidade(A('Comprovante FGTS Maranhão.pdf'), 'Equatorial Piauí');
t(f.cand.length === 0, '26: arquivo de outra unidade nunca entra');
f = sp.filtrarPorUnidade(A('Comprovante FGTS Amapá.pdf', 'Comprovante FGTS.pdf'), 'CEA');
t(f.cand.length === 1 && /Amap/.test(f.cand[0].name), '26: CEA = Amapá');
f = sp.filtrarPorUnidade(A('Comprovante 1.pdf', 'Comprovante 2.pdf'), 'Equatorial Goiás');
t(f.cand.length === 2, '26: dois sem unidade = continua ambíguo (o robô trava)');
f = sp.filtrarPorUnidade(A('x.pdf'), 'Unidade Inexistente');
t(f.cand.length === 0 && /sem par/.test(f.motivo), '26: unidade desconhecida');
t(sp.REGRAS[26].unidadeOpcional === true, '26 usa a unidade opcional');

// ---- 84: escolher a convenção por unidade e vigência
const C = (caminho, name) => ({ caminho, name });
let e = sp.escolherConvencao([C('06 Convenções Coletivas/Maranhão', 'CCT 2025-2026.pdf'), C('06 Convenções Coletivas/Piauí', 'CCT 2025-2026.pdf')], 'Equatorial Maranhão', 2026);
t(e.item && /Maranh/.test(e.item.caminho) && /confirmar a vigência/.test(e.aviso), '84: escolhe a da unidade');
e = sp.escolherConvencao([C('06 Convenções Coletivas/Pará', 'CCT 2024.pdf')], 'Equatorial Pará', 2026);
t(!e.item && /cobre 2026/.test(e.motivo), '84: convenção que não cobre o ano não serve');
e = sp.escolherConvencao([C('06/Goiás', 'ACT 2024-2025.pdf'), C('06/Goiás', 'ACT 2025-2026.pdf')], 'Equatorial Goiás', 2025);
t(e.item && /2025-2026|2025 2026/.test(e.item.name.replace('-', ' ')) && /mais recente/.test(e.aviso), '84: duas vigentes = a mais recente');
e = sp.escolherConvencao([C('06/Goiás', 'ACT A 2026.pdf'), C('06/Goiás', 'ACT B 2026.pdf')], 'Equatorial Goiás', 2026);
t(!e.item && /alguém escolhe/.test(e.motivo), '84: empate = ninguém escolhe');
e = sp.escolherConvencao([C('06/Alagoas', 'ACT 2026.pdf')], 'Equatorial Goiás', 2026);
t(!e.item && /nenhuma convenção da unidade/.test(e.motivo), '84: nenhuma da unidade');
e = sp.escolherConvencao([], 'Equatorial Goiás', 2026);
t(!e.item, '84: lista vazia');

console.log(`${ok} ok, ${falhou} falhou`);
process.exitCode = falhou ? 1 : 0;
