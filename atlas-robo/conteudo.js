// Conferência do conteúdo do PDF antes do envio ao Atlas (29/10). Usado pelo enviar.js; a leitura do texto é do ler-pdf.js.
const path = require('path');
const lerPdf = require('./ler-pdf');
const digitos = (s) => (s ? String(s).replace(/\D/g, '') : '');

// Conteúdo do PDF (29/10): palavras que o documento certo tem (tipo), que indicam OUTRO documento (negativos) e que não
// podem ir ao portal (sensiveis). Cada grupo casa quando todas as palavras aparecem (ver ler-pdf.js). mensal = confere o mês.
const CONTEUDO = {
  // 2 (VA): "refeição" saiu em 03/11, é o vale refeição (6).
  2: { tipo: [['alimentacao']], mensal: true },
  3: { tipo: [['transporte']], mensal: true },
  4: { tipo: [['seguro*'], ['segurado*'], ['apolice'], ['prudential']], mensal: true },
  7: { tipo: [['saude'], ['plano'], ['unimed'], ['assistencia medica'], ['operadora'], ['beneficiario*', 'fatura']], mensal: true },
  8: { tipo: [['ferias']] },
  9: { tipo: [['rescisao'], ['trct']] },
  // 10 e 24: a guia do FGTS Digital tem o MESMO modelo (as duas trazem "fgts mensal" e "fgts rescisorio" como colunas):
  // quem separa é o valor (gfd, ver tipoGfd). 06/11, calibrado nos PDFs reais da VPS.
  10: { tipo: [['fgts']], gfd: 'rescisoria' },
  24: { tipo: [['fgts']], mensal: true, gfd: 'mensal' },
  25: { tipo: [['fgts'], ['relacao', 'empregados'], ['relacao', 'trabalhadores']], mensal: true, gfd: 're' },
  // 26: o comprovante é o recibo do banco (PIX da Caixa) e não cita "FGTS" (calibrado nos PDFs reais em 29/10).
  26: { tipo: [['fgts'], ['comprovante', 'caixa'], ['comprovante', 'pix']], mensal: true },
  56: { tipo: [['salario*'], ['folha'], ['pagamento']], mensal: true },
  59: { tipo: [['darf'], ['arrecadacao'], ['recolhimento']], mensal: true },
  // 60 recibo × 61 relatório da DCTFWeb: o título da 1ª página separa (06/11, PDFs reais). O relatório cita "numero do recibo",
  // então o negativo do 61 é a frase inteira "recibo de entrega".
  60: { tipo: [['recibo de entrega', 'dctf*']], negativos: [['relatorio da declaracao completa'], ['declaracao completa', 'dctfweb']], mensal: true },
  61: { tipo: [['declaracao completa', 'dctf*']], negativos: [['recibo de entrega da declaracao']], mensal: true },
  63: { tipo: [['folha']], mensal: true },
  // validade: true = certidão com prazo: lê "Validade: dd/mm/aaaa" no texto e bloqueia se já venceu (a certidão LOCALIZADO pode vencer até o envio).
  64: { tipo: [['regularidade', 'fgts'], ['crf']], validade: true },
  65: { tipo: [['darf'], ['arrecadacao']], mensal: true },
  // recusa: o ASO demissional que registra recusa do colaborador não vai (regra da Milena: "verificar se não se recusou a fazer o ASO").
  67: { tipo: [['atestado', 'saude', 'ocupacional'], ['aso']],
    sensiveis: [['anamnese'], ['ficha clinica'], ['antecedentes', 'pessoais'], ['antecedentes', 'familiares']],
    recusa: [['recusou'], ['recusa', 'exame'], ['recusa', 'realizar'], ['colaborador', 'recusou']] },
  68: { tipo: [['esocial'], ['carteira de trabalho'], ['ctps']] },
  69: { tipo: [['pedido', 'demissao'], ['pedido', 'desligamento'], ['solicito', 'desligamento'], ['solicito', 'demissao'], ['pedir', 'demissao']],
    negativos: [['aviso previo', 'empregador'], ['aviso previo', 'comunicamos'], ['aviso previo', 'dispensa'], ['termino', 'experiencia'], ['contrato de experiencia', 'encerra*']] },
  // 78 ASO admissional/periódico: o mesmo cuidado de dado clínico do 67.
  78: { tipo: [['atestado', 'saude', 'ocupacional'], ['aso']],
    sensiveis: [['anamnese'], ['ficha clinica'], ['antecedentes', 'pessoais'], ['antecedentes', 'familiares']] },
  79: { tipo: [['ficha', 'registro'], ['registro', 'empregado'], ['ficha', 'admissao']] },
  // 80: o eSocial da admissão. Texto de desligamento = é a baixa (68), não vai (Missão 1, pasta "Anexos Contratos" é genérica).
  80: { tipo: [['esocial'], ['e social']], negativos: [['desligamento'], ['rescisao'], ['s-2299'], ['s 2299'], ['s2299']] },
  81: { tipo: [['certidao', 'federa*'], ['certidao', 'receita federal']], validade: true },
  82: { tipo: [['debitos', 'trabalhistas'], ['cndt']], validade: true },
  83: { tipo: [['ponto'], ['frequencia'], ['time tracking']], mensal: true },
};

// Travas por DOCUMENTO (não por pendência): o documento só sai quando o usuário libera (ENVIO_DOCS_LIBERADOS="59,63").
// 59 e 63: a Milena diz que "já sobem automático" (outro processo). Sem confirmar quem sobe, o robô não envia (risco de envio em dobro).
const TRAVAS_DOC = {
  59: 'segurado: a Milena diz que o comprovante de recolhimento "já sobe automático"; confirmar quem envia antes de liberar (ENVIO_DOCS_LIBERADOS=59)',
  63: 'segurado: a Milena diz que o extrato da folha "já está automatizado"; confirmar quem envia antes de liberar (ENVIO_DOCS_LIBERADOS=63)',
};
function travaDoDocumento(docId, env = process.env) {
  const liberados = String(env.ENVIO_DOCS_LIBERADOS || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
  return TRAVAS_DOC[docId] && !liberados.includes(Number(docId)) ? TRAVAS_DOC[docId] : null;
}

// Validade de certidão no texto (já normalizado: minúsculo, sem acento): "validade: 27/10/2026 a 25/11/2026" (vale a última data),
// "valida ate 05/04/2027", "data de validade 30/04/2027". Devolve { data: 'AAAA-MM-DD' | null, vencida: bool | null }.
function validadeDoTexto(texto, hoje = new Date().toISOString().slice(0, 10)) {
  const datas = [];
  for (const m of String(texto || '').matchAll(/(?:validade|valida ate|valido ate|vencimento|vence em)[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:a|ate|-)\s*(\d{2})\/(\d{2})\/(\d{4}))?/g)) {
    datas.push(`${m[3]}-${m[2]}-${m[1]}`);
    if (m[4]) datas.push(`${m[6]}-${m[5]}-${m[4]}`);
  }
  if (!datas.length) return { data: null, vencida: null };
  const data = datas.sort().at(-1);
  return { data, vencida: data < hoje };
}

// Que guia do FGTS é o texto (já normalizado). Na GFD a linha "total fgts: A B C D E" traz o total e as colunas; nos PDFs reais (06/11):
//   rescisória: D + E (indenização compensatória + encargos) > 0   ex.: "total fgts: 1.677,93 0,00 0,00 669,94 1.007,99"
//   mensal:     D = E = 0                                           ex.: "total fgts: 287.197,41 89,27 287.108,14 0,00 0,00" (870 trabalhadores)
// Sem essa linha, a RE (relação de trabalhadores) tem uma linha por trabalhador com a categoria depois da data ("##/##/#### mensal").
// Devolve { guia: 'rescisoria' | 'mensal' | null, re: bool } (re = parece RE: só trabalhadores "mensal", nenhum rescisório).
function tipoGfd(texto) {
  const t = String(texto || '');
  const num = (s) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0;
  const totais = [...t.matchAll(/total fgts:\s*([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})/g)];
  let guia = null;
  if (totais.length) guia = totais.some((m) => num(m[4]) + num(m[5]) > 0) ? 'rescisoria' : 'mensal';
  const categorias = [...t.matchAll(/\d{2}\/\d{2}\/\d{4} (mensal|rescisori[oa]|multa rescisoria)\b/g)].map((m) => m[1]);
  const re = !totais.length && categorias.length > 0 && categorias.every((c) => c === 'mensal');
  // resc = detalhamento de rescisão sem o total da guia (linhas "rescisorio"/"multa rescisoria"): é da GFD rescisória.
  const resc = !totais.length && categorias.some((c) => c !== 'mensal');
  return { guia, re, resc };
}

// Lê o PDF e decide. Bloqueia (bloqueio != null) quando o conteúdo mostra que é o documento errado:
// tem o CPF de outra pessoa e não o da pendência, tem palavra de outro documento, tem conteúdo que não pode ir,
// ou tem texto e não tem nenhuma palavra do tipo. PDF sem texto (imagem) não bloqueia: fica com confiança média.
// confianca: alta = tipo confere (e o CPF, quando o documento traz CPF); media = não deu para conferir tudo; baixa = bloqueado.
async function conferirConteudo(arquivo, linha) {
  const regra = CONTEUDO[linha.doc_id];
  if (!regra || path.extname(arquivo).toLowerCase() !== '.pdf') return null;
  const leitura = await lerPdf.lerTexto(arquivo);
  const r = lerPdf.conferir(leitura, { ...regra, cpf: digitos(linha.cpf) || null, competencia: regra.mensal ? linha.competencia : null });
  const c = { lido: r.lido, paginas: r.paginas ?? null, tipo: r.tipo || [], negativos: r.negativos || [], sensiveis: r.sensiveis || [],
    cpf: r.cpf || null, competencia: r.competencia ?? null, bloqueio: null, confianca: 'media', motivo: r.motivo || null };
  if (!r.lido) return c;
  if (regra.recusa && lerPdf.casaGrupos(leitura.texto, regra.recusa).length) {
    c.bloqueio = 'o ASO registra recusa do colaborador: conferir antes de enviar (regra da Milena)';
    c.confianca = 'baixa';
    return c;
  }
  if (regra.validade) {
    const v = validadeDoTexto(leitura.texto);
    c.validade = v.data;
    if (v.vencida) { c.bloqueio = `certidão vencida em ${v.data.split('-').reverse().join('/')}: tirar outra`; c.confianca = 'baixa'; return c; }
    if (!v.data) c.motivo = 'validade não encontrada no texto da certidão: conferir a data'; // não bloqueia: só vira confiança média
  }
  if (r.sensiveis.length) c.bloqueio = `conteúdo que não pode ir ao portal (${r.sensiveis.join('; ')}): mandar só a parte pedida`;
  else if (r.negativos.length && !r.tipo.length) c.bloqueio = `o conteúdo é de outro documento (${r.negativos.join('; ')})`;
  else if (r.negativos.length) c.bloqueio = `o conteúdo tem sinais de outro documento (${r.negativos.join('; ')}): conferir`;
  else if (r.cpf && !r.cpf.achou && r.cpf.outros) c.bloqueio = `o PDF traz o CPF de outra pessoa e não o desta pendência`;
  else if (!r.tipo.length) c.bloqueio = `o conteúdo não parece "${linha.nome}" (nenhuma palavra-chave do tipo no texto)`;
  if (!c.bloqueio && regra.gfd) {
    const g = tipoGfd(leitura.texto);
    c.gfd = g.guia || (g.re ? 're' : g.resc ? 'rescisoria' : null);
    const RESC = 'é da GFD RESCISÓRIA (indenização/encargos ou trabalhadores rescisórios)';
    if (regra.gfd === 'rescisoria' && g.guia === 'mensal') c.bloqueio = 'é a guia do FGTS MENSAL (sem indenização nem encargos rescisórios), não a GFD rescisória';
    else if (regra.gfd === 'rescisoria' && g.re) c.bloqueio = 'é a RE (relação de trabalhadores do mês, todos "mensal"), não a GFD rescisória';
    else if (regra.gfd === 'mensal' && (g.guia === 'rescisoria' || g.resc)) c.bloqueio = `${RESC}, não a guia do FGTS mensal`;
    else if (regra.gfd === 'mensal' && g.re) c.bloqueio = 'é a RE (relação de trabalhadores), não a guia do FGTS mensal';
    else if (regra.gfd === 're' && g.guia) c.bloqueio = `é a GUIA do FGTS (${g.guia === 'mensal' ? 'mensal' : 'rescisória'}), não a RE (relação de trabalhadores)`;
    else if (regra.gfd === 're' && g.resc) c.bloqueio = `${RESC}, não a RE do mês`;
  }
  if (c.bloqueio) c.confianca = 'baixa';
  else if ((!r.cpf || r.cpf.achou) && !(regra.validade && !c.validade)) c.confianca = 'alta';
  return c;
}

module.exports = { CONTEUDO, TRAVAS_DOC, conferirConteudo, travaDoDocumento, validadeDoTexto, tipoGfd };
