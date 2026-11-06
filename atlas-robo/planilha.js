// Gera a planilha Excel (out/pendencias.xlsx) a partir da última coleta gravada em out/atlas.db.
// Abas: Resumo, Atrasados, Próximas entregas, Reprovados.
// Uso: node planilha.js [destino.xlsx]   (também é chamado no fim do pendencias.js)
const path = require('path');
const ExcelJS = require('exceljs');
const { DatabaseSync } = require('node:sqlite');

const OUT = path.join(__dirname, 'out');
const DB = process.env.ATLAS_DB || path.join(OUT, 'atlas.db');
const ABAS = ['Atrasados', 'Próximas entregas', 'Reprovados'];
const COR = 'FF0B4F6C';

const COLUNAS = [
  ['Documento', 'documento', 45],
  ['Funcionário', 'funcionario', 28],
  ['CPF', 'cpf', 15],
  ['Tipo', 'tipo', 15],
  ['Cliente', 'cliente', 20],
  ['Unidade(s)', 'unidades', 24],
  ['Categoria', 'categoria', 24],
  ['Nº do pedido', 'pedido', 13],
  ['CNPJ fornecedor/filial', 'cnpj_filial', 20],
  ['Nº de docs', 'n_docs', 10],
  ['Prazo de envio', 'prazo_envio', 14],
  ['Competência', 'competencia', 12],
  ['Situação', 'status', 18],
  ['Enviado em', 'enviado_em', 14],
  ['Validado em', 'validado_em', 14],
  ['Motivo da reprovação', 'motivo_reprovacao', 60],
];
const SITUACAO = { DelayNotSent: 'Não enviado no prazo', DelayRejected: 'Reprovado (atrasado)', PendingNotSent: 'A enviar', Rejected: 'Reprovado' };
const DATAS = new Set(['prazo_envio', 'enviado_em', 'validado_em']);
const comoData = (s) => (s ? new Date(s.slice(0, 10) + 'T12:00:00') : null);

function cabecalho(ws) {
  const r = ws.getRow(1);
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR } };
  r.alignment = { vertical: 'middle', wrapText: true };
  r.height = 30;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function gerarPlanilha(destino = path.join(OUT, 'pendencias.xlsx')) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const coleta = db.prepare('SELECT * FROM coletas ORDER BY id DESC LIMIT 1').get();
  if (!coleta) throw new Error('Nenhuma coleta no banco. Rode node pendencias.js antes.');
  const linhas = db.prepare('SELECT * FROM pendencias WHERE coleta_id = ? ORDER BY prazo_envio, documento').all(coleta.id);
  db.close();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Robô Atlas';

  // Resumo
  const res = wb.addWorksheet('Resumo');
  res.columns = [{ width: 70 }, { width: 14 }, { width: 18 }];
  res.addRow(['Pendências Atlas (AFM Gestão)']).font = { bold: true, size: 14, color: { argb: COR } };
  res.addRow([`Coletado em ${new Date(coleta.coletado_em).toLocaleString('pt-BR')}`]);
  res.addRow([]);
  for (const [nome, n] of [['Atrasados', coleta.atrasados], ['Próximas entregas', coleta.proximas], ['Reprovados (também estão em Atrasados)', coleta.reprovados], ['Entregues (não listados)', coleta.entregues]]) {
    const r = res.addRow([nome, n]);
    r.getCell(1).font = { bold: true };
  }
  for (const aba of ABAS) {
    res.addRow([]);
    const t = res.addRow([aba, 'Quantidade', 'Prazo mais antigo']);
    t.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR } };
    const grupos = new Map();
    for (const l of linhas.filter((x) => x.aba === aba)) {
      const g = grupos.get(l.documento) || { n: 0, prazo: l.prazo_envio };
      g.n++;
      if (l.prazo_envio && l.prazo_envio < g.prazo) g.prazo = l.prazo_envio;
      grupos.set(l.documento, g);
    }
    for (const [doc, g] of [...grupos].sort((a, b) => b[1].n - a[1].n)) {
      res.addRow([doc, g.n, comoData(g.prazo)]).getCell(3).numFmt = 'dd/mm/yyyy';
    }
  }

  // Uma aba por situação, com as colunas da tela do portal.
  for (const aba of ABAS) {
    const ws = wb.addWorksheet(aba);
    ws.columns = COLUNAS.map(([header, key, width]) => ({ header, key, width }));
    for (const l of linhas.filter((x) => x.aba === aba)) {
      const r = {};
      for (const [, k] of COLUNAS) r[k] = DATAS.has(k) ? comoData(l[k]) : k === 'status' ? SITUACAO[l[k]] || l[k] : l[k];
      ws.addRow(r);
    }
    for (const k of DATAS) ws.getColumn(k).numFmt = 'dd/mm/yyyy';
    cabecalho(ws);
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS.length } };
  }

  await wb.xlsx.writeFile(destino);
  return { destino, linhas: linhas.length };
}

module.exports = { gerarPlanilha };

if (require.main === module) {
  gerarPlanilha(process.argv[2] ? path.resolve(process.argv[2]) : undefined)
    .then(({ destino, linhas }) => console.log(`Planilha gerada: ${destino} (${linhas} linhas)`))
    .catch((e) => {
      console.error('ERRO:', e.message);
      process.exitCode = 1;
    });
}
