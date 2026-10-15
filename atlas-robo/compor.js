// Compõe o pacote de uma pendência (doc_id 8, 9 ou 10) unindo as partes num PDF só, pelo Gotenberg,
// no mesmo formato de caminho e nome que a sincronização Factorial usa: <pasta>/factorial/<id>/doc<doc_id>_<cpf>_<MM-AAAA>.pdf
// e (com --gravar) registra no Neon estado COMPOSTO, caminho_origem, tamanho_bytes e hash_arquivo (SHA-256).
//
// Uso:
//   node compor.js --id 129 parte1.pdf parte2.pdf              só confere e mostra o que faria
//   node compor.js --id 129 parte1.pdf parte2.pdf --gravar     une, salva e grava no Neon
// Opções: --pasta <raiz dos downloads> (padrão FACTORIAL_PASTA_DOWNLOAD ou out/downloads), --substituir, --forcar
//
// Ordem das partes (a mesma do guia da sincronização):
//   8  aviso -> recibo -> comprovante
//   9  TRCT -> termo de quitação assinado -> comprovante
//   10 guia -> comprovante
// Regras para não brigar com a sincronização:
//   - linha em COMPOSTO só é refeita com --substituir;
//   - o UPDATE só vale se o estado ainda for o que foi lido (se a sincronização mexeu no meio, não grava);
//   - só toca em estado, caminho_origem, tamanho_bytes, hash_arquivo e atualizado_em.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { conexao } = require('./neon');
const { unirPdfs } = require('./unir-pdfs');

const PACOTES = {
  8: { nome: 'Aviso e recibo de férias', partes: ['aviso', 'recibo', 'comprovante'] },
  9: { nome: 'TRCT', partes: ['TRCT', 'termo de quitação assinado', 'comprovante'] },
  10: { nome: 'GFD rescisória', partes: ['guia', 'comprovante'] },
};
const ESTADOS_OK = ['PENDENTE_ENVIO', 'LOCALIZADO'];

function nomeFinal(l) {
  const [mm, aaaa] = String(l.competencia || '').split('/');
  if (!l.cpf || !mm || !aaaa) throw new Error(`Linha ${l.id} sem CPF ou competência (MM/AAAA); não dá para nomear o arquivo.`);
  return `doc${l.doc_id}_${l.cpf}_${mm.padStart(2, '0')}-${aaaa}`;
}

async function compor({ id, arquivos, pasta, gravar = false, substituir = false, forcar = false, log = console.log }) {
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (defina ROBO_DATABASE_URL ou ROBO_ENV_FILE).');
  const sql = neon(url);
  const [l] = await sql.query('select id, doc_id, cpf, competencia, estado from documentos where id = $1', [Number(id)]);
  if (!l) throw new Error(`Pendência ${id} não encontrada no Neon.`);
  const pacote = PACOTES[l.doc_id];
  if (!pacote) throw new Error(`doc_id ${l.doc_id} não é um pacote (só 8, 9 e 10).`);
  if (l.estado === 'COMPOSTO' && !substituir) throw new Error(`Pendência ${id} já está COMPOSTO (use --substituir para refazer).`);
  if (l.estado !== 'COMPOSTO' && !ESTADOS_OK.includes(l.estado)) throw new Error(`Pendência ${id} está em ${l.estado}; só componho ${ESTADOS_OK.join(' ou ')} (ou COMPOSTO com --substituir).`);
  if (!arquivos.length) throw new Error('Nenhum PDF informado.');
  if (arquivos.length !== pacote.partes.length && !forcar)
    throw new Error(`doc_id ${l.doc_id} (${pacote.nome}) leva ${pacote.partes.length} parte(s): ${pacote.partes.join(' -> ')}. Recebi ${arquivos.length} (use --forcar para ignorar).`);

  const nome = nomeFinal(l);
  const destinoDir = path.join(pasta, 'factorial', String(l.id));
  log(`Pendência ${l.id}: doc_id ${l.doc_id} (${pacote.nome}), estado ${l.estado}`);
  arquivos.forEach((a, i) => log(`  ${i + 1}. ${pacote.partes[i] || 'parte extra'}: ${a}`));
  log(`  saída: ${path.join(destinoDir, nome + '.pdf')}`);
  if (!gravar) {
    log('Simulação: nada foi unido nem gravado (use --gravar).');
    return null;
  }

  const destino = await unirPdfs({ arquivos, nome, saida: destinoDir, substituir: true });
  const dados = fs.readFileSync(destino);
  const hash = crypto.createHash('sha256').update(dados).digest('hex');
  const r = await sql.query(
    `update documentos set estado = 'COMPOSTO', caminho_origem = $1, tamanho_bytes = $2, hash_arquivo = $3, atualizado_em = now()
     where id = $4 and estado = $5 returning id`,
    [destino, dados.length, hash, l.id, l.estado],
  );
  if (!r.length) throw new Error(`O estado da pendência ${l.id} mudou durante a composição; nada foi gravado no Neon (o arquivo ficou em ${destino}).`);
  log(`Gravado: COMPOSTO, ${dados.length} bytes, sha256 ${hash.slice(0, 12)}...`);
  return destino;
}

module.exports = { compor, nomeFinal, PACOTES };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const opc = {};
    const arquivos = [];
    for (let i = 0; i < args.length; i++) {
      if (['--gravar', '--substituir', '--forcar'].includes(args[i])) opc[args[i].slice(2)] = true;
      else if (args[i].startsWith('--')) opc[args[i].slice(2)] = args[++i];
      else arquivos.push(args[i]);
    }
    if (!opc.id) throw new Error('Informe --id <id da pendência no Neon>.');
    const pasta = opc.pasta || process.env.FACTORIAL_PASTA_DOWNLOAD || path.join(__dirname, 'out', 'downloads');
    await compor({ id: opc.id, arquivos, pasta, gravar: !!opc.gravar, substituir: !!opc.substituir, forcar: !!opc.forcar });
  })().catch((e) => {
    console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exitCode = 1;
  });
}
