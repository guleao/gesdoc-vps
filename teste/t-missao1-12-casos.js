// Missão 1 (Operação Pente-Fino, 03/11): os 12 casos do relatório de 30/10 em que "o arquivo existe, mas o nome do documento
// não está na nossa lista de busca" (ficha-documentos-atrasados-atlas-2026-10-30.xlsx, aba Detalhes), reproduzidos com os
// mesmos nomes de pasta/arquivo (nome da pessoa trocado por um fictício), + casos novos e casos em que NADA pode ser escolhido.
// Rodar: node teste/t-missao1-12-casos.js
const path = require('path');
const A = (m) => require(path.join(__dirname, '..', 'atlas-robo', m));
const { classificar } = A('classificar');
const rf = A('regras-factorial');
const lerPdf = A('ler-pdf');
const { CONTEUDO } = A('conteudo');
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };

const PASTAS = { 1: 'BR-ASO', 2: 'Anexos Contratos', 3: 'BR-Ferias', 4: 'Offboarding', 5: 'Onboarding', 6: 'Documentos pessoais' };
let seq = 500;
const D = (folder_id, filename, extra = {}) => ({ id: ++seq, folder_id, filename, extension: '.pdf', created_at: '2026-09-05T10:00:00Z', signature_status: null, ...extra });
const un = (doc, lista, comp = '09/2026') => rf.escolherUnico(rf.UNICOS[doc], lista, PASTAS, comp);
const leitura = (txt) => ({ texto: lerPdf.normalizar(txt), temTexto: true, paginas: 1 });
const semTipo = (txt) => rf.confirmarSemTipo(rf.UNICOS[78], txt === null ? { temTexto: false } : leitura(txt), lerPdf.casaGrupos);
const conteudo80 = (txt) => lerPdf.conferir(leitura(txt), CONTEUDO[80]);

// ===== 1. O nome que o Atlas usa agora é reconhecido (antes: fora da lista = nem procurava)
t(classificar('ASO admissional/Periódico')?.doc === 78, 'nome Atlas "ASO admissional/Periódico" -> 78');
t(classificar('Comprovante de Registro E-Social')?.doc === 80, 'nome Atlas "Comprovante de Registro E-Social" -> 80');
t(classificar('Recibo de férias + comprovante de pagamento')?.doc === 8, 'nome Atlas "Recibo de férias + comprovante de pagamento" -> 8');

// ===== 2. Casos 1-5: ASO admissional/periódico (BR-ASO)
for (const [n, arq] of [[1, 'ASO ADMISSIONAL - Fulano Lima Rezende.pdf'], [2, 'ASO ADMISSIONAL - Beltrano Costa.pdf'], [4, 'ASO ADMISSIONAL - Sicrano Souza Barros.pdf']]) {
  const e = un(78, [D(1, arq), D(6, 'RG.pdf')]);
  t(e.ok && !e.semTipo && e.d.filename === arq, `caso ${n}: ASO admissional achado pelo nome (${e.motivo || ''})`);
}
// caso 3: "ASO <NOME>.pdf", sem o tipo no nome -> achado como "sem tipo" e só vale se o texto confirmar
let e = un(78, [D(1, 'ASO GIOVANNI GOMES.pdf')]);
t(e.ok && e.semTipo, 'caso 3: ASO sem tipo no nome vira candidato "sem tipo"');
t(semTipo('ATESTADO DE SAÚDE OCUPACIONAL  Exame: ( X ) Admissional  ( ) Periódico') === null, 'caso 3: texto diz admissional -> vale');
t(/imagem/.test(semTipo(null)), 'caso 3: PDF sem texto -> alguém confere (não envia)');
t(/outro/.test(semTipo('ATESTADO DE SAÚDE OCUPACIONAL Exame demissional')), 'caso 3: texto demissional -> bloqueado');
t(/outro/.test(semTipo('ASO - Admissional - mudança de função')), 'caso 3: texto de mudança de função -> bloqueado');
t(/tambem nao|também não/.test(semTipo('ATESTADO DE SAÚDE OCUPACIONAL apto')), 'caso 3: texto sem o tipo -> alguém confere');
// caso 5: 2 ASO da pessoa (admissional + "Admissional - Alteração") -> ambíguo, bloqueado para validação humana
e = un(78, [D(1, 'ASO ADMISSIONAL - Fulano Vinicius.pdf'), D(1, 'ASO Admissional - Alteração - Fiscal de Obras de Subestação.pdf')]);
t(!e.ok && /alguém escolhe/.test(e.motivo), 'caso 5: 2 ASO possíveis -> bloqueado (alguém escolhe)');
// o "sem tipo" nunca é usado quando já há um ASO com tipo (mesmo que o com tipo esteja fora do período)
e = un(78, [D(1, 'ASO ADMISSIONAL - Fulano.pdf'), D(1, 'ASO FULANO.pdf')]);
t(e.ok && !e.semTipo && /ADMISSIONAL/.test(e.d.filename), '78: com tipo ganha do sem tipo');
e = un(78, [D(1, 'ASO FULANO.pdf'), D(1, 'ASO FULANO 2.pdf')]);
t(!e.ok && /alguém escolhe/.test(e.motivo), '78: dois "sem tipo" -> alguém escolhe');
t(!un(78, [D(1, 'ASO DEMISSIONAL - Fulano.pdf')]).ok, '78: demissional nunca');
t(!un(78, [D(1, 'ASO Mudança de função - Fulano.pdf')]).ok, '78: mudança de função não entra como sem tipo');
t(!un(78, [D(1, 'ASO Retorno ao trabalho.pdf')]).ok, '78: retorno ao trabalho não entra como sem tipo');
t(!un(78, [D(6, 'ASO FULANO.pdf')]).ok, '78: ASO fora de pasta de saúde não entra');
t(!un(78, [D(1, 'ASO FULANO.pdf', { created_at: '2024-01-10T00:00:00Z' })]).ok, '78: sem tipo fora do período não entra');
// variações novas (não estavam no relatório)
t(un(78, [D(1, 'aso_periodico_2026.pdf')]).ok, '78 novo: aso_periodico');
t(un(78, [D(1, 'Atestado de Saúde Ocupacional - Admissional.pdf')]).ok, '78 novo: nome por extenso');

// ===== 3. Casos 6-11: Comprovante de Registro E-Social, arquivo em "Anexos Contratos > eSocial.pdf"
for (let n = 6; n <= 11; n++) {
  const e = un(80, [D(2, 'eSocial.pdf'), D(2, 'Contrato de trabalho.pdf'), D(6, 'CPF.pdf')]);
  t(e.ok && e.d.filename === 'eSocial.pdf', `caso ${n}: eSocial em Anexos Contratos achado (${e.motivo || ''})`);
}
t(un(80, [D(2, 'Comprovante e-Social admissão.pdf')]).ok && un(80, [D(5, 'eSocial.pdf')]).ok, '80 novo: e-Social / onboarding');
t(un(80, [D(5, 'Recibo eSocial S-2200.pdf')]).ok, '80 novo: recibo S-2200');
t(!un(80, [D(4, 'eSocial.pdf')]).ok, '80: offboarding nunca (é a baixa, 68)');
t(!un(80, [D(2, 'Baixa eSocial.pdf')]).ok, '80: baixa no nome nunca');
t(!un(80, [D(2, 'eSocial.pdf'), D(2, 'eSocial (1).pdf')]).ok, '80: dois eSocial -> alguém escolhe');
t(!un(80, [D(6, 'eSocial.pdf')]).ok, '80: pasta pessoal genérica não entra');
// conteúdo (conteudo.js, antes de gravar): texto da baixa é barrado, admissão passa
let c = conteudo80('eSocial Recibo de entrega do evento S-2200 Cadastramento inicial do vínculo e admissão');
t(c.tipo.length && !c.negativos.length, '80 conteúdo: admissão passa');
c = conteudo80('eSocial Recibo do evento S-2299 Desligamento');
t(c.negativos.length > 0, `80 conteúdo: desligamento barrado (${c.negativos})`);
c = conteudo80('eSocial S-2299 informações do vínculo');
t(c.negativos.length > 0, `80 conteúdo: S-2299 sozinho barrado (${c.negativos})`);

// ===== 4. Caso 12: Recibo de férias + comprovante (doc 8) - regra de várias peças (sem aviso, porque o Atlas não pede)
const pecas = rf.pecasDoDoc(8, 'Recibo de férias + comprovante de pagamento');
t(pecas.pecas.join() === 'recibo,comprovanteFerias', 'caso 12: só recibo + comprovante (sem exigir aviso)');
e = rf.escolherPartes(8, 'Recibo de férias + comprovante de pagamento', '09/2026',
  [D(3, 'Recibo de férias.pdf'), D(3, 'Comprovante de pagamento férias.pdf'), D(4, 'Aviso prévio.pdf')], PASTAS);
t(e.ok && e.partes.map((p) => p.papel).join() === 'recibo,comprovanteFerias', `caso 12: monta recibo > comprovante (${e.motivo || ''})`);
e = rf.escolherPartes(8, 'Recibo de férias + comprovante de pagamento', '09/2026', [D(3, 'Recibo de férias.pdf')], PASTAS);
t(!e.ok && /comprovante/.test(e.motivo), 'caso 12: sem o comprovante não monta (diz o que falta)');

console.log(`${ok} ok, ${falhou} falhou`);
process.exitCode = falhou ? 1 : 0;
