// Teste (03/11): busca na Factorial dos docs 8, 9, 10 (várias peças) e 79, 80, 83 (arquivo único) por palavras do nome.
// Usa documentos falsos no formato da API da Factorial (sem rede). Uso: node teste/t-regras-factorial.js
const path = require('path');
const rf = require(path.join(__dirname, '..', 'atlas-robo', 'regras-factorial'));
const fa = require(path.join(__dirname, '..', 'atlas-robo', 'factorial'));
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };

const PASTAS = { 1: 'Férias', 2: 'Offboarding', 3: 'Onboarding', 4: 'BR-Folha do ponto', 5: 'BR ASO', 6: 'Documentos pessoais' };
let seq = 100;
const D = (folder_id, filename, extra = {}) => ({ id: ++seq, folder_id, filename, extension: '.pdf', created_at: '2026-08-12T10:00:00Z', signature_status: null, ...extra });
const papeis = (e) => e.partes.map((p) => p.papel).join('>');

// ---- períodos no nome
t(rf.periodosNoNome('Aviso 08-2026.pdf').includes('2026-08'), 'periodo 08-2026');
t(rf.periodosNoNome('2026_09_cartao.pdf').includes('2026-09'), 'periodo 2026_09');
t(rf.periodosNoNome('Férias agosto de 2026').includes('2026-08'), 'periodo agosto de 2026');
t(rf.periodosNoNome('full_version_time_tracking_for_October_2026.pdf').includes('2026-10'), 'periodo October 2026');
t(rf.periodosNoNome('Recibo.pdf').length === 0, 'sem periodo');
t(rf.noPeriodo(D(1, 'Aviso.pdf'), '08/2026'), 'janela: criado em agosto');
t(!rf.noPeriodo(D(1, 'Aviso.pdf', { created_at: '2025-01-05T00:00:00Z' }), '08/2026'), 'janela: criado em 2025 fora');
t(rf.noPeriodo(D(1, 'Aviso.pdf', { created_at: '2026-07-20T00:00:00Z' }), '08/2026'), 'janela: 20 dias antes ainda vale');
t(!rf.noPeriodo(D(1, 'Aviso 03-2025.pdf'), '08/2026'), 'janela: nome cita 03/2025 (longe)');
t(rf.noPeriodo(D(1, 'Aviso 09-2026.pdf', { created_at: '2020-01-01T00:00:00Z' }), '08/2026'), 'janela: nome cita mês vizinho');
t(!rf.noPeriodo(D(4, 'ponto.pdf'), '08/2026', 'exato'), 'exato: sem mês no nome não vale');

// ---- doc 8 férias (Milena, 06/11): recibo (ou o aviso, que vale como recibo) + comprovante, para qualquer nome do item
const AV = 'Aviso + Recibo de férias + Comprovante de pagamento';
let docs = [D(1, 'Aviso de férias.pdf'), D(1, 'Recibo de férias.pdf'), D(1, 'Comprovante de pagamento.pdf'), D(2, 'Aviso prévio.pdf')];
let e = rf.escolherPartes(8, AV, '08/2026', docs, PASTAS);
t(e.ok && papeis(e) === 'reciboOuAviso>comprovanteFerias' && /Recibo/.test(e.partes[0].d.filename), `8 com aviso e recibo = o recibo: ${JSON.stringify(e.motivo || papeis(e))}`);
e = rf.escolherPartes(8, 'Recibo de férias + Comprovante de pagamento', '08/2026', docs, PASTAS);
t(e.ok && papeis(e) === 'reciboOuAviso>comprovanteFerias' && !e.avisos.length, '8: item sem "aviso" monta igual, sem aviso de confirmação');
e = rf.escolherPartes(8, AV, '08/2026', [D(1, 'Aviso de férias.pdf'), D(1, 'Comprovante.pdf')], PASTAS);
t(e.ok && /Aviso de férias/.test(e.partes[0].d.filename), '8: só o aviso (sem recibo) vale como recibo');
e = rf.escolherPartes(8, AV, '08/2026', [D(2, 'Aviso prévio.pdf'), D(1, 'Comprovante.pdf')], PASTAS);
t(!e.ok && /recibo de férias/.test(e.motivo), '8: "aviso prévio" não vale como recibo de férias');
e = rf.escolherPartes(8, AV, '08/2026', [D(1, 'Recibo de férias.pdf'), D(1, 'Recibo de férias 2.pdf'), D(1, 'Comprovante.pdf')], PASTAS);
t(!e.ok && /alguém escolhe/.test(e.motivo), '8: dois recibos no período = ninguém escolhe');
e = rf.escolherPartes(8, AV, '08/2026', [D(1, 'Recibo de férias.pdf', { created_at: '2025-02-01T00:00:00Z' }), D(1, 'Comprovante.pdf')], PASTAS);
t(!e.ok && /nenhum do período/.test(e.motivo), '8: recibo de outro ano não entra');
e = rf.escolherPartes(8, AV, '08/2026', [D(1, 'Recibo de férias.pdf', { created_at: '2025-02-01T00:00:00Z' }), D(1, 'Recibo de férias.pdf'), D(1, 'Comprovante.pdf')], PASTAS);
t(e.ok && papeis(e) === 'reciboOuAviso>comprovanteFerias', '8: dois recibos, só um do período = escolhe o do período');
e = rf.escolherPartes(8, AV, '08/2026', [D(1, 'Recibo de férias.png', { extension: '.png' }), D(1, 'Comprovante.pdf')], PASTAS);
t(!e.ok && /não é PDF/.test(e.motivo), '8: imagem não é PDF');
e = rf.escolherPartes(8, AV, '08/2026', [D(1, 'Recibo de férias.pdf')], PASTAS);
t(!e.ok && /comprovante/.test(e.motivo), '8: sem comprovante não monta');

// ---- doc 9 TRCT
const rescisao = [D(2, 'Termo de Rescisão (TRCT).pdf', { signature_status: 'signed' }), D(2, 'Termo de quitação.pdf', { signature_status: 'completed' }), D(2, 'Comprovante pagamento TRCT.pdf')];
e = rf.escolherPartes(9, 'TRCT com comprovante de pagamento', '08/2026', rescisao, PASTAS);
t(e.ok && papeis(e) === 'trct>quitacao>comprovanteTrct', `9 completo: ${e.motivo || papeis(e)}`);
e = rf.escolherPartes(9, 'Termo de Rescisão do Contrato de Trabalho - TRCT', '08/2026', rescisao, PASTAS);
t(e.ok && papeis(e) === 'trct>quitacao', '9: item só do TRCT não leva o comprovante');
e = rf.escolherPartes(9, 'Comprovante de Pagamento do TRCT', '08/2026', rescisao, PASTAS);
t(e.ok && papeis(e) === 'comprovanteTrct' && /só o comprovante/.test(e.avisos[0]), '9: "Comprovante de pagamento do TRCT" = só o comprovante, com aviso');
e = rf.escolherPartes(9, 'TRCT com comprovante de pagamento', '08/2026', [D(2, 'TRCT.pdf', { signature_status: 'pending' }), rescisao[2]], PASTAS);
t(!e.ok && e.aguardando && /sem assinatura/.test(e.motivo), '9: TRCT sem assinatura = aguardando');
e = rf.escolherPartes(9, 'TRCT com comprovante de pagamento', '08/2026', [rescisao[0], rescisao[2]], PASTAS);
t(e.ok && papeis(e) === 'trct>comprovanteTrct', '9: termo de quitação é opcional');
e = rf.escolherPartes(9, 'TRCT com comprovante de pagamento', '08/2026', [rescisao[0], D(2, 'Comprovante GFD fgts.pdf')], PASTAS);
t(!e.ok && /falta comprovante do TRCT/.test(e.motivo), '9: comprovante do FGTS não vale como o do TRCT');
e = rf.escolherPartes(9, 'TRCT com comprovante de pagamento', '08/2026', [rescisao[0], rescisao[2], D(2, 'TRCT retificado.pdf', { signature_status: 'signed' })], PASTAS);
t(!e.ok && /alguém escolhe/.test(e.motivo), '9: dois TRCT = ninguém escolhe');

// ---- doc 10 GFD
const gfd = [D(2, 'GFD rescisória.pdf'), D(2, 'Comprovante GFD.pdf')];
e = rf.escolherPartes(10, 'Guia do FGTS Digital Rescisória (GFD Rescisória) + Comprovante de pagamento', '08/2026', [...rescisao, ...gfd], PASTAS);
t(e.ok && papeis(e) === 'guiaFgts>comprovanteFgts', `10 completo: ${e.motivo || papeis(e)}`);
e = rf.escolherPartes(10, 'Guia do FGTS Digital Rescisória (GFD Rescisória) + Comprovante de pagamento', '08/2026', [D(2, 'Guia FGTS Digital.pdf'), D(2, 'Comprovante do FGTS.pdf')], PASTAS);
t(e.ok && papeis(e) === 'guiaFgts>comprovanteFgts', '10: "Guia FGTS Digital" + "Comprovante do FGTS"');
e = rf.escolherPartes(10, 'Guia do FGTS Digital Rescisória (GFD Rescisória) + Comprovante de pagamento', '08/2026', [gfd[0]], PASTAS);
t(!e.ok && /falta comprovante da guia do FGTS/.test(e.motivo), '10: falta o comprovante');
e = rf.escolherPartes(10, 'GFD', '08/2026', rescisao, PASTAS);
t(!e.ok && /falta guia do FGTS/.test(e.motivo), '10: só TRCT na pasta = falta a guia');
const usados = rf.escolherPartes(10, 'GFD', '08/2026', [D(2, 'Guia FGTS.pdf')], PASTAS);
t(!usados.ok, '10: não repete a guia como comprovante');
e = rf.escolherPartes(67, 'ASO demissional', '08/2026', docs, PASTAS);
t(!e.ok && /sem regra de várias peças/.test(e.motivo), 'doc de arquivo único não passa pelas peças');

// ---- arquivo único 79, 80, 83 (+ 67/68/69)
const un = (doc, pasta, nome, comp, extra) => {
  const r = rf.UNICOS[doc], d = D(pasta, nome, extra);
  return r.pastas.test(rf.normalizar(PASTAS[pasta])) && r.achar(rf.normalizar(nome)) && (!r.periodo || rf.noPeriodo(d, comp, r.periodo));
};
t(un(79, 3, 'Ficha de Registro.pdf'), '79 ficha de registro'); t(un(79, 3, 'ficha_de_registro_empregado.pdf'), '79 variação');
t(!un(79, 2, 'Ficha de Registro.pdf'), '79 não na pasta offboarding'); t(!un(79, 3, 'Contrato.pdf'), '79 outro arquivo');
t(un(80, 3, 'Comprovante de registro eSocial.pdf'), '80 eSocial na admissão'); t(un(80, 3, 'e-Social admissão.pdf'), '80 variação');
t(!un(80, 3, 'Baixa eSocial.pdf'), '80 não pega a baixa'); t(!un(80, 2, 'eSocial.pdf'), '80 não na offboarding');
t(un(83, 4, 'full_version_time_tracking_for_August_2026_Fulano.pdf', '08/2026'), '83 mês certo');
t(!un(83, 4, 'full_version_time_tracking_for_July_2026_Fulano.pdf', '08/2026'), '83 mês errado');
t(!un(83, 4, 'full_version_time_tracking_for_August_2026.pdf', '09/2026'), '83 mês errado 2');
t(un(83, 4, 'Folha do ponto 08-2026.pdf', '08/2026'), '83 variação PT');
t(!un(83, 2, 'time_tracking_August_2026.pdf', '08/2026'), '83 pasta errada');
t(un(67, 5, 'ASO Demissional.pdf'), '67 BR ASO'); t(un(68, 2, 'Baixa CTPS.pdf'), '68'); t(un(69, 2, 'Pedido de demissão.pdf'), '69'); t(!un(69, 2, 'Aviso prévio.pdf'), '69 aviso prévio fora');

// ---- docsLigados
t(fa.docsLigados(['node', 'f.js'], {}).join() === '67,68,69,78,79,80,83,8', 'padrão 67,68,69,78,79,80,83 e 8 (09/11; 9 e 10 ficam desligados)');
t(fa.docsLigados(['node', 'f.js', '--docs', '8,9,10'], {}).join() === '8,9,10', '--docs 8,9,10');
t(fa.docsLigados(['node', 'f.js'], { FACTORIAL_DOCS: '67,8' }).join() === '67,8', 'FACTORIAL_DOCS');
t(fa.docsLigados(['node', 'f.js', '--docs', '8,8'], {}).join() === '8', 'sem repetir');
let recusou = false; try { fa.docsLigados(['node', 'f.js', '--docs', '2'], {}); } catch { recusou = true; }
t(recusou, '--docs com número sem regra é recusado');
t(fa.COMPOSTOS.join() === '8,9,10' && Object.keys(fa.REGRAS).map(Number).sort((a, b) => a - b).join() === '67,68,69,78,79,80,83', 'lista de documentos cobertos');

// ---- situação do colaborador (ativo / desligado), regra da Milena para 67/68/69 e 78/79/80
const HOJE = '2026-11-03';
const sit = (e) => rf.situacaoFuncionario(e, HOJE);
t(sit({ terminated_on: null }) === 'ativo', 'sem data de desligamento = ativo');
t(sit({ terminated_on: '2026-10-20' }) === 'desligado', 'data passada = desligado');
t(sit({ terminated_on: '2026-11-30' }) === 'desligando', 'data futura = desligando');
t(sit({ active: false }) === 'desligado' && sit({ active: true }) === 'ativo', 'campo active');
t(sit({ status: 'terminated' }) === 'desligado' && sit({ status: 'active' }) === 'ativo', 'campo status');
t(sit({ id: 1, first_name: 'x' }) === null && sit(null) === null, 'sem campo nenhum = não sabe');
const serve = (doc, e) => rf.colaboradorServe(rf.UNICOS[doc], e, HOJE);
t(!serve(67, { terminated_on: null }).ok && /ativo/.test(serve(67, { terminated_on: null }).motivo), '67: ativo não serve');
t(!serve(68, { active: true }).ok && !serve(69, { status: 'active' }).ok, '68/69: ativo não serve');
t(serve(67, { terminated_on: '2026-10-20' }).ok && serve(67, { terminated_on: '2026-11-30' }).ok, '67: desligado/desligando serve');
t(serve(67, { id: 1 }).ok && serve(67, { id: 1 }).situacao === null, '67: sem informação passa (com aviso no relatório)');
t(!serve(78, { terminated_on: '2026-10-20' }).ok && serve(78, { terminated_on: null }).ok, '78: desligado não serve, ativo serve');
t(!serve(79, { active: false }).ok && serve(80, { active: true }).ok, '79/80: desligado não serve');
t(rf.UNICOS[79].ignorar({ competencia: '06/2024' }) && !rf.UNICOS[79].ignorar({ competencia: '06/2026' }), '79: pedido de 2024 é desconsiderado');

// ---- 78 ASO admissional/periódico (pasta de saúde, 1 arquivo no período)
const fp78 = (pasta, nome) => rf.UNICOS[78].pastas.test(rf.normalizar(pasta)) && rf.UNICOS[78].achar(rf.normalizar(nome));
t(fp78('BR ASO', 'ASO Admissional.pdf') && fp78('BR ASO', 'ASO periódico 2026.pdf') && fp78('Saúde', 'Atestado de Saúde Ocupacional - Periódico.pdf'), '78 casa admissional e periódico');
t(!fp78('BR ASO', 'ASO Demissional.pdf') && !fp78('BR ASO', 'Exame.pdf'), '78 não pega demissional nem exame genérico');
t(rf.UNICOS[78].periodo === 'janela' && rf.noPeriodo(D(5, 'ASO.pdf'), '08/2026', 'janela'), '78 exige o período');

console.log(`${ok} ok, ${falhou} falhou`);
process.exitCode = falhou ? 1 : 0;
