// Une vários PDFs num só, pelo Gotenberg, e salva com o nome do documento que o Atlas pede.
// Não envia nada ao Atlas: só gera o arquivo.
//
// Uso:
//   node unir-pdfs.js --nome "CND Federal" a.pdf b.pdf c.pdf
//   node unir-pdfs.js --pendencia 57 a.pdf b.pdf        (pega o nome na tabela documentos do Neon, coluna nome)
// Opções: --saida <pasta> (padrão out/unidos, ou out/unidos/<pendência> com --pendencia), --substituir
//
// As páginas saem na ordem dos arquivos informados. O Gotenberg une em ordem alfabética do nome do arquivo,
// por isso cada parte é enviada como 001.pdf, 002.pdf, ...
// Caracteres que não podem ir em nome de arquivo (\ / : * ? " < > |) viram "-". Ex.: "Baixa na CTPS e/ou E-social"
// fica "Baixa na CTPS e-ou E-social.pdf".
//
// GOTENBERG_URL: endereço do serviço (padrão http://127.0.0.1:3010, o serviço services/pdf da VPS).
const fs = require('fs');
const path = require('path');

const GOTENBERG = (process.env.GOTENBERG_URL || 'http://127.0.0.1:3010').replace(/\/+$/, '');
const OUT = path.join(__dirname, 'out', 'unidos');

const nomeArquivo = (nome) =>
  String(nome).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 150);

// arquivos: caminhos dos PDFs, na ordem das páginas. nome: nome do documento no Atlas. Retorna o caminho gerado.
async function unirPdfs({ arquivos, nome, saida = OUT, substituir = false }) {
  if (!nome) throw new Error('Informe o nome do documento (o nome que o Atlas pede).');
  if (!arquivos || !arquivos.length) throw new Error('Nenhum PDF informado.');
  const final = nomeArquivo(nome) + '.pdf';
  const destino = path.join(saida, final);
  if (fs.existsSync(destino) && !substituir) throw new Error(`Já existe ${destino} (use --substituir).`);

  const form = new FormData();
  arquivos.forEach((a, i) => {
    const dados = fs.readFileSync(a);
    if (dados.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`Não é PDF: ${a}`);
    form.append('files', new Blob([dados], { type: 'application/pdf' }), String(i + 1).padStart(3, '0') + '.pdf');
  });

  // Um arquivo só também passa pelo Gotenberg: sai normalizado e com o nome certo.
  const r = await fetch(`${GOTENBERG}/forms/pdfengines/merge`, {
    method: 'POST',
    body: form,
    headers: { 'Gotenberg-Output-Filename': path.parse(final).name },
  });
  if (!r.ok) throw new Error(`Gotenberg HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const pdf = Buffer.from(await r.arrayBuffer());
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('O Gotenberg não devolveu um PDF.');

  fs.mkdirSync(saida, { recursive: true });
  fs.writeFileSync(destino, pdf);
  return destino;
}

// Nome do documento de uma pendência gravada pelo robô no Neon (ver neon.js).
async function nomeDaPendencia(id) {
  const { conexao } = require('./neon');
  const { neon } = require('@neondatabase/serverless');
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (defina ROBO_DATABASE_URL ou ROBO_ENV_FILE).');
  const [l] = await neon(url).query('select nome from documentos where id = $1 and aba is not null', [Number(id)]);
  if (!l) throw new Error(`Pendência ${id} não encontrada no Neon.`);
  return l.nome;
}

module.exports = { unirPdfs, nomeArquivo };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opc = {};
    const arquivos = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--substituir') opc.substituir = true;
      else if (args[i].startsWith('--')) opc[args[i].slice(2)] = args[++i];
      else arquivos.push(args[i]);
    }
    const nome = opc.nome || (opc.pendencia && (await nomeDaPendencia(opc.pendencia)));
    const saida = opc.saida || (opc.pendencia ? path.join(OUT, String(opc.pendencia)) : OUT);
    const destino = await unirPdfs({ arquivos, nome, saida, substituir: opc.substituir });
    console.log(`PDF gerado: ${destino} (${arquivos.length} parte(s))`);
  })().catch((e) => {
    console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exitCode = 1;
  });
}
