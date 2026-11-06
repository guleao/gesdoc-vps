// Leitura do conteúdo do PDF (29/10). Tira o texto de dentro do arquivo e compara com o que a pendência pede:
// palavras-chave do tipo de documento, palavras que indicam outro documento, CPF, número do contrato e competência.
// Não é IA: é comparação de texto. PDF que é só imagem (escaneado, sem camada de texto) volta com temTexto = false
// e nada é concluído pelo conteúdo. Nunca devolve CPF nem trecho do texto, só o que casou.
// Fonte única: atlas-robo/ler-pdf.js. O painel usa uma CÓPIA (services/painel/ler-pdf.js): editar aqui e copiar.
// pdf.js (Mozilla, Apache-2.0) vai junto em vendor/pdfjs, sem npm install, porque o painel roda sem node_modules.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const VENDOR = path.join(__dirname, 'vendor', 'pdfjs');
const MAX_PAGINAS = 40;
let lib = null;

async function pdfjs() {
  if (!lib) {
    // Sem @napi-rs/canvas o pdf.js avisa que não desenha páginas; aqui só se lê texto, então o aviso é calado.
    const { log, warn } = console;
    console.log = console.warn = (...a) => { if (!/^Warning: Cannot (load|polyfill)/.test(String(a[0]))) log(...a); };
    try { lib = await import(pathToFileURL(path.join(VENDOR, 'pdf.min.mjs')).href); } finally { Object.assign(console, { log, warn }); }
    lib.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(VENDOR, 'pdf.worker.min.mjs')).href;
  }
  return lib;
}

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');

// buf = Buffer do PDF ou caminho. Devolve { paginas, lidas, texto (normalizado), temTexto } ou { erro }.
async function lerTexto(buf) {
  try {
    if (typeof buf === 'string') buf = fs.readFileSync(buf);
    const { getDocument } = await pdfjs();
    const doc = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 }).promise;
    const partes = [];
    const lidas = Math.min(doc.numPages, MAX_PAGINAS);
    for (let i = 1; i <= lidas; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      partes.push(tc.items.map((x) => x.str + (x.hasEOL ? '\n' : ' ')).join(''));
    }
    const paginas = doc.numPages;
    await doc.destroy();
    const texto = normalizar(partes.join('\n'));
    return { paginas, lidas, texto, temTexto: texto.replace(/[^a-z0-9]/g, '').length >= 40 };
  } catch (e) {
    return { erro: `não deu para ler o PDF (${String(e.message || e).split('\n')[0]})` };
  }
}

// Um grupo casa quando TODAS as palavras dele aparecem no texto, como palavra inteira ("aso" não casa com "caso");
// "ergonom*" = começa com. Devolve os grupos que casaram ("a + b").
const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const temPalavra = (texto, w) => {
  const p = normalizar(w).trim();
  const prefixo = p.endsWith('*');
  return new RegExp(`(^|[^a-z0-9])${escapar(prefixo ? p.slice(0, -1) : p).replace(/ /g, '\\s+')}${prefixo ? '' : '(?![a-z0-9])'}`).test(texto);
};
const casaGrupos = (texto, grupos = []) => grupos.filter((g) => g.every((w) => temPalavra(texto, w))).map((g) => g.join(' + '));

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
  }
  return true;
}
// CPFs válidos que aparecem no texto (com ou sem pontuação).
const cpfsNoTexto = (texto) => [...new Set([...texto.matchAll(/(?<!\d)(\d{3})\.?\s?(\d{3})\.?\s?(\d{3})\s?-?\s?(\d{2})(?!\d)/g)]
  .map((m) => m.slice(1).join('')).filter(cpfValido))];

// "00223/2025 - PA" -> { num: '223', ano: '2025' }
const numContrato = (x) => {
  const m = String(x || '').match(/(\d+)\s*\/\s*(\d{4})/) || String(x || '').match(/(\d+)/);
  return m ? { num: m[1].replace(/^0+/, ''), ano: m[2] || null } : null;
};
// Contratos conhecidos que aparecem no texto ("00223/2025", "4600029823/2024"...), comparados sem os zeros da frente.
// Número curto (menos de 5 dígitos, ex.: 356) só conta junto com o ano ("356/2026"), para não confundir com página ou endereço.
function contratosNoTexto(texto, conhecidos = []) {
  const achados = new Set();
  for (const c of conhecidos.map(numContrato).filter((x) => x && x.num.length >= 3)) {
    const ano = c.ano ? `\\s*/\\s*${c.ano}` : '';
    if (c.num.length < 5 && !ano) continue;
    if (new RegExp(`(?<![\\d./])0*${c.num}${c.num.length < 5 ? ano : `(${ano})?`}(?!\\d)`).test(texto)) achados.add(c.num);
  }
  return [...achados];
}

const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// "07/2026" ou "2026-07": o texto cita o mês (07/2026, 07.2026, julho/2026, julho de 2026, jul/2026)?
function citaCompetencia(texto, competencia) {
  const m = String(competencia || '').match(/^(\d{1,2})\/(\d{4})$/) || String(competencia || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const [mes, ano] = m[1].length === 4 ? [Number(m[2]), m[1]] : [Number(m[1]), m[2]];
  const mm = String(mes).padStart(2, '0');
  const nome = MESES[mes - 1];
  return new RegExp(`(?<!\\d)${mm}\\s?[/.\\-]\\s?${ano}(?!\\d)|${nome}\\s?(de\\s|/|-)?\\s?${ano}|${nome.slice(0, 3)}\\s?[/.\\-]\\s?${ano}`).test(texto);
}

// Confere o texto contra o que a pendência pede. criterios = {
//   tipo: [[...palavras]] (o documento certo), negativos: [[...]] (indicam OUTRO documento), sensiveis: [[...]] (não pode ir),
//   cpf: '123...' (o da pendência), contrato: '00223/2025', contratos: [todos os conhecidos], competencia: '07/2026' }
// Devolve só o que casou e contagens; nunca o CPF nem o texto.
function conferir(leitura, criterios = {}) {
  if (!leitura || leitura.erro) return { lido: false, motivo: leitura?.erro || 'sem leitura' };
  if (!leitura.temTexto) return { lido: false, paginas: leitura.paginas, motivo: 'PDF sem texto (imagem escaneada): o conteúdo não foi conferido' };
  const t = leitura.texto;
  const r = { lido: true, paginas: leitura.paginas, tipo: casaGrupos(t, criterios.tipo), negativos: casaGrupos(t, criterios.negativos),
    sensiveis: casaGrupos(t, criterios.sensiveis) };
  if (criterios.cpf) {
    const cpf = soDigitos(criterios.cpf);
    const cpfs = cpfsNoTexto(t);
    r.cpf = { achou: cpfs.includes(cpf), outros: cpfs.filter((c) => c !== cpf).length };
  }
  if (criterios.contrato) {
    const proprio = numContrato(criterios.contrato)?.num;
    const achados = contratosNoTexto(t, [...(criterios.contratos || []), criterios.contrato]);
    r.contrato = { achou: achados.includes(proprio), outros: achados.filter((c) => c !== proprio) };
  }
  if (criterios.competencia) r.competencia = citaCompetencia(t, criterios.competencia);
  return r;
}

module.exports = { lerTexto, conferir, normalizar, casaGrupos, temPalavra, cpfsNoTexto, cpfValido, contratosNoTexto, numContrato, citaCompetencia };

// node ler-pdf.js arquivo.pdf [palavra ...]: mostra páginas, se tem texto e quais palavras aparecem (sem imprimir o texto).
if (require.main === module) {
  (async () => {
    const [arq, ...palavras] = process.argv.slice(2);
    const l = await lerTexto(arq);
    if (l.erro) { console.log(l.erro); process.exit(1); }
    console.log(`${l.paginas} página(s), ${l.lidas} lida(s), tem texto: ${l.temTexto ? 'sim' : 'não'}, ${l.texto.length} caracteres`);
    for (const w of palavras) console.log(`  "${w}": ${temPalavra(l.texto, w) ? 'aparece' : 'não aparece'}`);
    console.log(`  CPFs válidos no texto: ${cpfsNoTexto(l.texto).length}`);
  })();
}
