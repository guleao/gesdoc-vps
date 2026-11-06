// Reconhece o documento do Atlas pelas PALAVRAS do nome (03/11/2026), para o nome não precisar ser idêntico ao da lista do neon.js.
// Pedido da equipe dos clientes: o Atlas muda o texto ("Vale Alimentação - relação + boleto"), e nome exato deixava a pendência de fora.
// Cada tipo tem: tem = grupos que TODOS precisam aparecer (dentro do grupo, qualquer palavra serve) e nao = palavras que o impedem.
// Só reconhece quando UM tipo casa. Dois tipos casando (ex.: "Alimentação/Refeição") = ambíguo: não classifica, e quem decide é uma pessoa.
const normalizar = (s) => ` ${String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

// Palavras inteiras: ' va ' não casa com 'valor'. Prefixo com * no fim (rescisori*).
const p = (w) => (w.endsWith('*') ? new RegExp(` ${w.slice(0, -1)}[a-z0-9]*`) : new RegExp(` ${w} `));
const R = (tem, nao = []) => ({ tem: tem.map((g) => g.map(p)), nao: nao.map(p) });

const TIPOS = {
  2: R([['alimentacao', 'va', 'v a']]),
  3: R([['transporte', 'vt', 'v t']]),
  4: R([['seguro']]),
  6: R([['refeicao', 'vr', 'v r']]),
  7: R([['saude', 'assistencia medica']], ['aso', 'atestado', 'ocupacional']),
  8: R([['ferias']]),
  9: R([['trct', 'tcrt', 'rescisao']], ['gfd', 'fgts']),
  10: R([['gfd', 'fgts'], ['rescisori*', 'rescisao']]),
  24: R([['fgts', 'gfd'], ['guia', 'boleto', 'recolhimento']], ['comprovante', 'rescisori*', 'regularidade', 'crf', 'cnd', 'relacao', 'empregados']),
  25: R([['fgts'], ['relacao', 'empregados', 'trabalhadores', 're']], ['rescisori*', 'regularidade', 'crf', 'cnd']),
  26: R([['fgts'], ['comprovante']], ['rescisori*', 'regularidade', 'crf', 'cnd']),
  56: R([['comprovante'], ['salario', 'salarios', 'folha']], ['fgts', 'recolhimento', 'dctfweb']),
  59: R([['comprovante'], ['recolhimento']], ['fgts']),
  60: R([['dctfweb', 'dctf'], ['recibo']], ['relatorio']),
  61: R([['dctfweb', 'dctf'], ['relatorio']], ['recibo']),
  63: R([['folha'], ['analitica', 'mensal', 'extrato']], ['comprovante', 'ponto', 'salario', 'salarios']),
  64: R([['regularidade', 'crf', 'cnd'], ['fgts']]),
  65: R([['darf']], ['comprovante']),
  66: R([['ocorrencias', 'ocorrencia']]),
  67: R([['aso', 'atestado'], ['demissional']]),
  68: R([['ctps', 'esocial', 'e social'], ['baixa']]),
  69: R([['pedido de demissao', 'pedido de desligamento', 'carta de desligamento', 'carta de demissao']]),
  78: R([['aso', 'atestado'], ['admissional', 'periodico']]),
  79: R([['ficha de registro', 'ficha registro']]),
  80: R([['registro'], ['esocial', 'e social']], ['baixa', 'ctps', 'ficha']),
  81: R([['cnd', 'certidao'], ['federal', 'federais', 'receita federal']], ['fgts', 'trabalhista', 'trabalhistas']),
  82: R([['cndt', 'debitos trabalhistas', 'certidao negativa de debitos trabalhistas']]),
  83: R([['cartao de ponto', 'folha de ponto', 'controle de frequencia']]),
  84: R([['convencao coletiva', 'acordo coletivo', 'acordo individual']]),
};

// { doc, tipo: 'palavras' } | { doc: null, ambiguo: [ids] } | { doc: null }
function classificar(nome) {
  const t = normalizar(nome);
  const achou = Object.entries(TIPOS).filter(([, r]) => r.tem.every((g) => g.some((re) => re.test(t))) && !r.nao.some((re) => re.test(t))).map(([id]) => Number(id));
  if (achou.length === 1) return { doc: achou[0], tipo: 'palavras' };
  if (achou.length > 1) return { doc: null, ambiguo: achou };
  return { doc: null };
}

module.exports = { classificar, TIPOS, normalizar };
