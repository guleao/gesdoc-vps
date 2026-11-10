// Declaração do Vale Refeição (doc 6), pela resposta da Milena em 06/11: a NIP pôs uma declaração MODELO, já assinada, na pasta do
// V.A ("Declaração MODELO - VR - Equatorial.pdf"); o robô só troca a data todo mês. O resto da página (texto, assinatura, logo) não muda.
//
// Como troca: o Chromium do Playwright desenha a página 1 do modelo com o pdf.js (vendor/pdfjs) em alta resolução, acha pela camada de
// texto a linha da data ("Vitória, 02 de outubro de 2026."), cobre só essa linha de branco e escreve a data nova no mesmo lugar e
// tamanho; a página vira um PDF do mesmo tamanho. Se não achar exatamente UMA linha com "<cidade>, <dia> de <mês> de <ano>", não gera.
// O PDF gerado é imagem (sem camada de texto): o conferirConteudo não bloqueia PDF só imagem.
//
// Uso (teste): node declaracao-vr.js modelo.pdf saida.pdf [AAAA-MM-DD]
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, 'vendor', 'pdfjs');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dataPorExtenso = (d) => `${String(d.getDate()).padStart(2, '0')} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;

const PAGINA = `<!doctype html><meta charset="utf-8"><body style="margin:0"><canvas id="c"></canvas>
<script type="module">
import * as pdfjs from '/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
window.gerar = async (dataNova) => {
  const buf = new Uint8Array(await (await fetch('/modelo.pdf')).arrayBuffer());
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  if (doc.numPages !== 1) return { erro: 'o modelo tem ' + doc.numPages + ' páginas (esperado 1)' };
  const pag = await doc.getPage(1);
  const ESCALA = 3;
  const vp = pag.getViewport({ scale: ESCALA });
  const cv = document.getElementById('c');
  cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await pag.render({ canvasContext: ctx, viewport: vp }).promise;
  // linhas da camada de texto (itens com o mesmo y)
  const tc = await pag.getTextContent();
  const linhas = new Map();
  for (const it of tc.items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    if (!linhas.has(y)) linhas.set(y, []);
    linhas.get(y).push(it);
  }
  const norm = (s) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/\\s+/g, '');
  const RE = /^[a-z]+(?:[a-z ]*)?,\\d{1,2}de(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)de20\\d{2}\\.?$/;
  const achadas = [...linhas.entries()].map(([y, its]) => {
    its.sort((a, b) => a.transform[4] - b.transform[4]);
    return { y, its, texto: its.map((i) => i.str).join('') };
  }).filter((l) => RE.test(norm(l.texto)));
  if (achadas.length !== 1) return { erro: achadas.length ? achadas.length + ' linhas com data no modelo' : 'linha da data ("Cidade, DD de mês de AAAA") não encontrada no modelo' };
  const l = achadas[0];
  const cidade = l.texto.split(',')[0].trim();
  const x0 = Math.min(...l.its.map((i) => i.transform[4]));
  const x1 = Math.max(...l.its.map((i) => i.transform[4] + i.width));
  const alt = Math.max(...l.its.map((i) => Math.abs(i.transform[3]) || i.height || 11));
  const [ax, ay] = vp.convertToViewportPoint(x0, l.y);
  const [bx] = vp.convertToViewportPoint(x1, l.y);
  const h = alt * ESCALA;
  ctx.fillStyle = '#fff';
  ctx.fillRect(ax - 4, ay - h * 1.05, (bx - ax) + h * 6, h * 1.45);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.font = h + 'px Calibri, Carlito, "Liberation Sans", Arial, sans-serif';
  const novo = cidade + ', ' + dataNova + '.';
  ctx.fillText(novo, ax, ay);
  const base = pag.getViewport({ scale: 1 });
  return { png: cv.toDataURL('image/png'), largura: base.width, altura: base.height, antes: l.texto.replace(/\\s+/g, ' ').trim(), depois: novo };
};
window.pronto = true;
</script>`;

// modelo = Buffer do PDF modelo; data = Date (padrão: hoje). Devolve { buf, antes, depois } ou { erro }.
async function gerarDeclaracaoVR(modelo, data = new Date()) {
  if (!Buffer.isBuffer(modelo) || modelo.subarray(0, 5).toString('latin1') !== '%PDF-') return { erro: 'o modelo não é PDF' };
  const { chromium } = require('playwright');
  // CHROME_PATH (opcional) = Chrome instalado, para testar no Windows; na VPS vale o Chromium do Playwright da imagem.
  let nav;
  try { nav = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) }); }
  catch (e) { return { erro: `não abriu o Chromium: ${e.message.split('\n')[0]}` }; }
  try {
    const pg = await nav.newPage();
    await pg.route('http://declaracao.local/**', (rota) => {
      const u = new URL(rota.request().url()).pathname;
      if (u === '/') return rota.fulfill({ contentType: 'text/html', body: PAGINA });
      if (u === '/modelo.pdf') return rota.fulfill({ contentType: 'application/pdf', body: modelo });
      if (u === '/pdf.min.mjs' || u === '/pdf.worker.min.mjs') return rota.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR, u.slice(1))) });
      return rota.fulfill({ status: 404, body: '' });
    });
    await pg.goto('http://declaracao.local/');
    await pg.waitForFunction(() => window.pronto === true, null, { timeout: 30000 });
    const r = await pg.evaluate((d) => window.gerar(d), dataPorExtenso(data));
    if (r.erro) return { erro: r.erro };
    const w = r.largura, h = r.altura;
    await pg.setContent(`<!doctype html><style>@page{size:${w}pt ${h}pt;margin:0}html,body{margin:0;padding:0}img{width:${w}pt;height:${h}pt;display:block}</style><img src="${r.png}">`);
    await pg.waitForFunction(() => document.images[0] && document.images[0].complete);
    const buf = await pg.pdf({ width: `${(w / 72).toFixed(4)}in`, height: `${(h / 72).toFixed(4)}in`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return { buf, antes: r.antes, depois: r.depois };
  } catch (e) {
    return { erro: `não gerou a declaração: ${e.message.split('\n')[0]}` };
  } finally {
    await nav.close().catch(() => {});
  }
}

module.exports = { gerarDeclaracaoVR, dataPorExtenso };

if (require.main === module) (async () => {
  const [modelo, saida, dia] = process.argv.slice(2);
  if (!modelo || !saida) { console.log('uso: node declaracao-vr.js modelo.pdf saida.pdf [AAAA-MM-DD]'); process.exit(2); }
  const data = dia ? new Date(`${dia}T12:00:00`) : new Date();
  const r = await gerarDeclaracaoVR(fs.readFileSync(modelo), data);
  if (r.erro) { console.log('ERRO:', r.erro); process.exit(1); }
  fs.writeFileSync(saida, r.buf);
  console.log(`ok: "${r.antes}" -> "${r.depois}" (${r.buf.length} bytes)`);
})();
