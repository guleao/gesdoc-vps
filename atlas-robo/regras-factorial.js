// Regras de busca na Factorial dos documentos de VÁRIAS PARTES (8, 9, 10) e dos de arquivo único 79, 80, 83, por PALAVRAS do nome
// e da pasta (03/11/2026), sem exigir o nome exato. Só lógica (sem rede e sem banco): usado pelo factorial.js e pelo teste
// teste/t-regras-factorial.js. Regras do discovery da Milena (planilha v2) e do guia do Evilásio (DEPLOY.md).
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const ASSINATURA_OK = new Set([null, undefined, '', 'completed', 'signed', 'not_required']);

const MESES = [['janeiro', 'january'], ['fevereiro', 'february'], ['marco', 'march'], ['abril', 'april'], ['maio', 'may'], ['junho', 'june'],
  ['julho', 'july'], ['agosto', 'august'], ['setembro', 'september'], ['outubro', 'october'], ['novembro', 'november'], ['dezembro', 'december']];

// Meses (AAAA-MM) que o nome do arquivo cita: "08-2026", "2026-08", "agosto de 2026", "time tracking for august 2026".
function periodosNoNome(nome) {
  const n = normalizar(nome), ach = new Set();
  const dois = (m) => String(m).padStart(2, '0');
  for (const m of n.matchAll(/\b(0?[1-9]|1[0-2]) (20\d\d)\b/g)) ach.add(`${m[2]}-${dois(m[1])}`);
  for (const m of n.matchAll(/\b(20\d\d) (0?[1-9]|1[0-2])\b/g)) ach.add(`${m[1]}-${dois(m[2])}`);
  MESES.forEach((nomes, i) => { for (const nm of nomes) for (const m of n.matchAll(new RegExp(`\\b${nm}\\b(?: de| of)?\\s*(20\\d\\d)`, 'g'))) ach.add(`${m[1]}-${dois(i + 1)}`); });
  return [...ach];
}
const mesesEntre = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };

// O arquivo é do período da pendência (competência "MM/AAAA")?
//   exato  = o nome tem que citar o mês da competência (cartão de ponto: 1 PDF por mês);
//   janela = evento (férias, rescisão): o nome cita um mês até 2 meses de distância OU, sem mês no nome, o arquivo foi criado entre
//            45 dias antes e 75 dias depois do mês da competência.
function noPeriodo(d, competencia, modo = 'janela') {
  const m = String(competencia || '').match(/^(\d{2})\/(\d{4})$/);
  if (!m) return false;
  const ym = `${m[2]}-${m[1]}`, citados = periodosNoNome(d.filename);
  if (modo === 'exato') return citados.includes(ym);
  if (citados.length) return citados.some((c) => Math.abs(mesesEntre(ym, c)) <= 2);
  const criado = Date.parse(d.created_at);
  if (!criado) return false;
  const ini = Date.UTC(+m[2], +m[1] - 1, 1) - 45 * 864e5, fim = Date.UTC(+m[2], +m[1], 1) + 75 * 864e5;
  return criado >= ini && criado <= fim;
}

const ehPdf = (d) => /^\.?pdf$/i.test(String(d.extension || '').trim() || (String(d.filename || '').match(/\.[a-z0-9]+$/i) || [''])[0]);
// texto de busca de um arquivo: pasta + nome
const texto = (d, pastas) => `${normalizar(pastas[String(d.folder_id)])} | ${normalizar(d.filename)}`;
const nomeDe = (d) => normalizar(d.filename);

// Papéis de cada peça. escopo = onde procurar (pasta); achar = o arquivo (texto = "pasta | nome").
const PAPEL = {
  // 8 férias: pasta/nome com "férias". "aviso prévio" NÃO é aviso de férias.
  aviso: { rotulo: 'aviso de férias', escopo: /ferias/, achar: (t, n) => /\baviso\b/.test(n) && !/previo/.test(n), periodo: true },
  recibo: { rotulo: 'recibo de férias', escopo: /ferias/, achar: (t, n) => /\brecibo\b/.test(n), periodo: true },
  // Milena (06/11): "considerar o aviso de férias como o recibo de férias; upload do recibo + comprovante". Vale o recibo; sem recibo
  // no período, o aviso (nunca o aviso prévio). Os dois no período = o recibo (preferir).
  reciboOuAviso: { rotulo: 'recibo de férias (ou o aviso, que vale como recibo)', escopo: /ferias/, periodo: true,
    achar: (t, n) => /\brecibo\b/.test(n) || (/\baviso\b/.test(n) && !/previo/.test(n)), preferir: (n) => /\brecibo\b/.test(n) },
  comprovanteFerias: { rotulo: 'comprovante de pagamento das férias', escopo: /ferias/, achar: (t, n) => /comprovante/.test(n), periodo: true },
  // 9 rescisão (pasta offboarding): TRCT, termo de quitação (Evilásio) e o comprovante do TRCT.
  trct: { rotulo: 'TRCT', escopo: /offboard|rescis|desligament/, achar: (t, n) => /\btrct\b|\btcrt\b|termo de rescisao/.test(n) && !/comprovante|quitacao/.test(n), assinado: true },
  quitacao: { rotulo: 'termo de quitação', escopo: /offboard|rescis|desligament/, achar: (t, n) => /quitacao/.test(n), assinado: true, opcional: true },
  comprovanteTrct: { rotulo: 'comprovante do TRCT', escopo: /offboard|rescis|desligament/, achar: (t, n) => /comprovante/.test(n) && /trct|tcrt|rescisao|pagamento/.test(n) && !/fgts|\bgfd\b|guia/.test(n) },
  // 10 GFD rescisória (pasta offboarding): guia do FGTS Digital + o comprovante dela.
  guiaFgts: { rotulo: 'guia do FGTS (GFD)', escopo: /offboard|rescis|desligament/, achar: (t, n) => /\bgfd\b|guia.*fgts|fgts.*guia|fgts digital/.test(n) && !/comprovante/.test(n) },
  comprovanteFgts: { rotulo: 'comprovante da guia do FGTS', escopo: /offboard|rescis|desligament/, achar: (t, n) => /comprovante/.test(n) && /fgts|\bgfd\b|guia/.test(n) },
};

// Peças de cada pendência, na ORDEM do PDF. Depende do nome da pendência no Atlas (o 9 tem 3 nomes diferentes).
// aviso: avisos que vão para o painel porque a regra ainda não foi confirmada pela Milena.
function pecasDoDoc(docId, nomeAtlas) {
  const n = normalizar(nomeAtlas);
  // 8 férias (Milena, 06/11): recibo (ou o aviso, que vale como recibo) + comprovante, para qualquer nome do item no Atlas.
  if (docId === 8) return { pecas: ['reciboOuAviso', 'comprovanteFerias'], aviso: null };
  if (docId === 9) {
    if (/^comprovante de pagamento do trct/.test(n)) return { pecas: ['comprovanteTrct'], aviso: 'o item do Atlas pede só o comprovante do TRCT (a Milena baixa só ele): confirmar' };
    return { pecas: /comprovante/.test(n) ? ['trct', 'quitacao', 'comprovanteTrct'] : ['trct', 'quitacao'], aviso: null };
  }
  if (docId === 10) return { pecas: ['guiaFgts', 'comprovanteFgts'], aviso: null };
  return null;
}

// Escolhe as peças entre os documentos do funcionário. Devolve { ok: true, partes: [{papel, rotulo, d}], avisos } ou { ok: false, motivo }.
// Regras de segurança: peça com mais de um arquivo possível = ninguém escolhe sozinho; falta de assinatura (TRCT/quitação) = não monta;
// só PDF; o mesmo arquivo nunca entra em duas peças.
function escolherPartes(docId, nomeAtlas, competencia, docs, pastas) {
  const def = pecasDoDoc(docId, nomeAtlas);
  if (!def) return { ok: false, motivo: `doc ${docId} sem regra de várias peças` };
  const partes = [], avisos = def.aviso ? [def.aviso] : [], usados = new Set();
  for (const chave of def.pecas) {
    const p = PAPEL[chave];
    let cand = docs.filter((d) => !usados.has(d.id) && p.escopo.test(texto(d, pastas).split(' | ')[0] + ' ' + nomeDe(d)) && p.achar(texto(d, pastas), nomeDe(d)));
    if (!cand.length) { if (p.opcional) continue; return { ok: false, motivo: `falta ${p.rotulo} na Factorial` }; }
    if (cand.length > 1 || p.periodo) {
      const noPer = cand.filter((d) => noPeriodo(d, competencia, 'janela'));
      if (p.periodo && !noPer.length) return { ok: false, motivo: `${p.rotulo}: ${cand.length} arquivo(s), nenhum do período ${competencia}` };
      if (noPer.length) cand = noPer;
    }
    if (cand.length > 1 && p.preferir) { const pref = cand.filter((d) => p.preferir(nomeDe(d))); if (pref.length) cand = pref; }
    if (cand.length > 1) return { ok: false, motivo: `${p.rotulo}: ${cand.length} arquivos possíveis (${cand.map((d) => d.id).join(', ')}): alguém escolhe` };
    const d = cand[0];
    if (!ehPdf(d)) return { ok: false, motivo: `${p.rotulo} não é PDF` };
    if (p.assinado && !ASSINATURA_OK.has(d.signature_status)) return { ok: false, motivo: `${p.rotulo} sem assinatura (aguardando assinatura)`, aguardando: true };
    usados.add(d.id);
    partes.push({ papel: chave, rotulo: p.rotulo, d });
  }
  return { ok: true, partes, avisos };
}

// Documentos de ARQUIVO ÚNICO da Factorial: 67, 68, 69 (como antes, mais palavras) e 79, 80, 83.
// pastas = pasta do arquivo; achar = nome; periodo: 'exato' = o nome tem que citar o mês da competência.
// colaborador: 'desligando' = só vale para quem tem data de desligamento (demissionais: a Milena confere se o colaborador está ativo);
//              'ativo' = não vale para quem já saiu (admissionais). ignorar(l) = motivo para nem procurar.
const UNICOS = {
  67: { pastas: /\baso\b|offboard/, achar: (n) => /\baso\b|atestado (de )?saude ocupacional/.test(n) && /demissional|demissao|desligamento/.test(n), colaborador: 'desligando' },
  68: { pastas: /offboard/, achar: (n) => /\besocial\b|\be social\b|\bctps\b|carteira de trabalho|\bbaixa\b/.test(n), colaborador: 'desligando' },
  69: { pastas: /offboard/, achar: (n) => /pedido de (demissao|desligamento)|solicitacao de (demissao|desligamento)|carta de (desligamento|demissao)/.test(n), colaborador: 'desligando' },
  // ASO admissional/periódico: a Milena "junta os PDFs num só" mas não diz quais. Aqui só vai quando há UM arquivo do período
  // (2 ou mais = alguém escolhe) e o colaborador não pode ter saído ("cuidado para ver se o funcionário está ativo").
  78: { pastas: /\baso\b|saude|exame|admiss|periodic/, achar: (n) => /\baso\b|atestado (de )?saude ocupacional/.test(n) && /admissional|periodico|periodica|anual/.test(n) && !/demissional/.test(n),
    periodo: 'janela', colaborador: 'ativo',
    // Missão 1 (03/11), caso do relatório de 30/10: "BR-ASO > ASO <NOME>.pdf", sem o tipo no nome. Só entra se não houver ASO com tipo,
    // se for o ÚNICO assim no período, e se o TEXTO do PDF disser admissional/periódico (PDF imagem = alguém confere).
    semTipo: (n) => /\baso\b|atestado (de )?saude ocupacional/.test(n) && !/admissional|periodic|anual|demissional|demissao|desligamento|alteracao|mudanca|retorno/.test(n),
    confirmarTexto: { tipo: [['admissional'], ['periodico'], ['periodica']], negativos: [['demissional'], ['mudanca de funcao'], ['mudanca de riscos'], ['retorno ao trabalho']] },
    aviso: 'a Milena junta os PDFs do ASO num só, sem dizer quais: aqui só vai quando há 1 arquivo no período (confirmar com a Milena)' },
  // Ficha de registro e comprovante do eSocial da ADMISSÃO: pasta onboarding. (79: a Milena diz "desconsiderar último pedido em 2024".)
  79: { pastas: /onboard|admiss/, achar: (n) => /ficha de registro|ficha registro|registro de empregado|ficha de admissao/.test(n), colaborador: 'ativo',
    ignorar: (l) => (/\/2024$/.test(String(l.competencia || '')) ? 'Milena: "desconsiderar último pedido em 2024"' : null) },
  // 80: Missão 1 (03/11), 6 casos do relatório de 30/10: o arquivo está em "Anexos Contratos > eSocial.pdf" (não na onboarding).
  // A pasta é genérica: o conteudo.js barra texto de desligamento e a trava de hash barra o mesmo arquivo em outra pessoa.
  80: { pastas: /onboard|admiss|anexos? (de |dos? )?contratos?/, achar: (n) => /\besocial\b|\be social\b/.test(n) && !/baixa|desligamento|demissao/.test(n), colaborador: 'ativo' },
  // Cartão de ponto: pasta "BR-Folha do ponto", 1 PDF por colaborador por mês ("..._time_tracking_for_<mês>_<ano>...").
  83: { pastas: /ponto|frequencia|time tracking/, achar: (n) => /time tracking|folha do ponto|cartao de ponto|espelho de ponto/.test(n), periodo: 'exato',
    aviso: 'a Milena exporta um PDF com todos os colaboradores; aqui vai o PDF do próprio colaborador no mês (confirmar com a Milena)' },
};

// Escolhe o arquivo de um documento de ARQUIVO ÚNICO (factorial.js). Devolve { ok: true, d, semTipo } ou { ok: false, motivo }.
// 1º os arquivos com o tipo no nome; só se não houver nenhum, os "sem tipo" (regra.semTipo), que depois exigem o texto (confirmarSemTipo).
function escolherUnico(regra, lista, pastas, competencia) {
  const naPasta = lista.filter((d) => regra.pastas.test(normalizar(pastas[String(d.folder_id)])));
  const filtrar = (cand) => {
    if (regra.periodo) cand = cand.filter((d) => noPeriodo(d, competencia, regra.periodo));
    return { cand, aptos: cand.filter((d) => ASSINATURA_OK.has(d.signature_status) && ehPdf(d)) };
  };
  let { cand, aptos } = filtrar(naPasta.filter((d) => regra.achar(nomeDe(d))));
  let semTipo = false;
  if (!cand.length && regra.semTipo) { ({ cand, aptos } = filtrar(naPasta.filter((d) => regra.semTipo(nomeDe(d))))); semTipo = cand.length > 0; }
  if (aptos.length === 1) return { ok: true, d: aptos[0], semTipo };
  return { ok: false, motivo: !cand.length ? (regra.periodo ? `nenhum arquivo deste tipo do período ${competencia} na Factorial` : 'nenhum arquivo deste tipo na Factorial')
    : !aptos.length ? 'arquivo achado, mas não é PDF ou falta assinatura'
    : `${aptos.length} arquivos possíveis (${aptos.map((d) => d.id).join(', ')}): alguém escolhe` };
}

// Arquivo achado "sem tipo no nome": só vale se o texto do PDF confirmar o tipo. leitura = ler-pdf.lerTexto(). null = confirmado.
function confirmarSemTipo(regra, leitura, casaGrupos) {
  const c = regra.confirmarTexto;
  if (!c) return null;
  if (!leitura || leitura.erro || !leitura.temTexto) return 'o nome do arquivo não diz o tipo e o PDF não tem texto (imagem): alguém confere';
  const neg = casaGrupos(leitura.texto, c.negativos || []);
  if (neg.length) return `o nome do arquivo não diz o tipo e o texto indica outro (${neg.join('; ')})`;
  if (!casaGrupos(leitura.texto, c.tipo).length) return 'o nome do arquivo não diz o tipo e o texto também não: alguém confere';
  return null;
}

// Situação do colaborador na Factorial: 'ativo' (sem data de desligamento), 'desligando' (data de desligamento no futuro),
// 'desligado' (data passada) ou null (a API não trouxe nenhum campo: não dá para saber). Campos conhecidos: terminated_on (e variantes), active, status.
function situacaoFuncionario(e, hoje = new Date().toISOString().slice(0, 10)) {
  if (!e) return null;
  const chaves = ['terminated_on', 'termination_date', 'terminated_at', 'contract_end_date'];
  const k = chaves.find((c) => c in e);
  if (k) { const d = String(e[k] || '').slice(0, 10); return !d ? 'ativo' : d > hoje ? 'desligando' : 'desligado'; }
  if (typeof e.active === 'boolean') return e.active ? 'ativo' : 'desligado';
  if (typeof e.status === 'string') { const s = e.status.toLowerCase(); return /terminat|inactive|dismiss|deslig/.test(s) ? 'desligado' : /active|hired|ativo/.test(s) ? 'ativo' : null; }
  return null;
}
// Pode procurar documento deste tipo para este colaborador? motivo = por que não.
function colaboradorServe(regra, e, hoje) {
  const s = situacaoFuncionario(e, hoje);
  if (regra.colaborador === 'desligando' && s === 'ativo') return { ok: false, motivo: 'colaborador sem data de desligamento na Factorial (ativo): o documento de demissão não vale; conferir com o RH (Milena)' };
  if (regra.colaborador === 'ativo' && s === 'desligado') return { ok: false, motivo: 'colaborador já desligado na Factorial: documento de admissão/periódico não é cobrado; conferir com o RH' };
  return { ok: true, situacao: s };
}

module.exports = { normalizar, periodosNoNome, noPeriodo, escolherPartes, escolherUnico, confirmarSemTipo, pecasDoDoc, situacaoFuncionario, colaboradorServe, PAPEL, UNICOS, ASSINATURA_OK, ehPdf };
