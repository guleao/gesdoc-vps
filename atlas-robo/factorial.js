// Busca na Factorial os documentos das pendências do Atlas (SOMENTE LEITURA na Factorial) e deixa prontos para o enviar.js.
//
// Cobre só os documentos de ARQUIVO ÚNICO, com regra segura pelo nome do arquivo e a pasta (as mesmas dos 11 achados em 15/10):
//   67 ASO Demissional                              pasta BR-ASO ou Offboarding, nome com "ASO" e "demissional"
//   68 Baixa na CTPS e/ou e-Social                  pasta Offboarding, nome com "eSocial" ou "CTPS"
//   69 Pedido de demissão ou carta de desligamento  pasta Offboarding, nome com "pedido de demissão", "pedido de desligamento" ou "carta de desligamento"
//      ("aviso prévio" saiu em 19/10: a Milena não o citou e o aviso do empregador é outro documento)
// Os montados de várias partes (TRCT, GFD, benefícios: doc_id 2 a 10) ficam de fora: precisam de alguém escolher as partes.
//
// Para cada linha do robô no Neon com estado PENDENTE_ENVIO e um desses doc_id:
//   acha o funcionário pelo CPF (tem que ser exatamente 1), lista os documentos dele e aplica a regra;
//   exatamente 1 arquivo = baixa em out/downloads/factorial-docs/<id Factorial>.pdf e grava no Neon
//   estado LOCALIZADO, caminho_origem "factorial:<id>", tamanho_bytes e hash_arquivo (mesmo formato da sincronização do Evilásio);
//   0 ou mais de 1 = não mexe no Neon e só registra o motivo em out/envio/busca.json (o painel mostra).
// Uso: node factorial.js [--simular]      Variáveis: FACTORIAL_API_KEY (obrigatória), FACTORIAL_API_URL, ROBO_DATABASE_URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { conexao } = require('./neon');
const { OUT, log } = require('./comum');

const API = (process.env.FACTORIAL_API_URL || 'https://api.factorialhr.com/api/2026-07-01/resources').replace(/\/$/, '');
const CHAVE = (process.env.FACTORIAL_API_KEY || '').trim();
const PASTA = path.join(process.env.FACTORIAL_PASTA_DOWNLOAD || path.join(OUT, 'downloads'), 'factorial-docs');
const ARQ_BUSCA = path.join(OUT, 'envio', 'busca.json');

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const digitos = (s) => String(s || '').replace(/\D/g, '');
const REGRAS = {
  67: { pastas: /^(br aso|offboarding)$/, achar: (n) => /\baso\b/.test(n) && /demissional/.test(n) },
  68: { pastas: /^offboarding$/, achar: (n) => /\besocial\b|\be social\b|\bctps\b/.test(n) },
  69: { pastas: /^offboarding$/, achar: (n) => /pedido de (demissao|desligamento)|carta de desligamento/.test(n) },
};
const ASSINATURA_OK = new Set([null, undefined, '', 'completed', 'signed', 'not_required']);

async function api(caminho, opts = {}) {
  let r;
  for (let t = 0; t < 4; t++) { // 429 = limite de chamadas: espera e tenta de novo
    r = await fetch(`${API}${caminho}`, { ...opts, headers: { 'x-api-key': CHAVE, accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}) } });
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  if (r.status === 401) throw new Error('Factorial respondeu 401: chave errada.');
  if (!r.ok) throw new Error(`Factorial respondeu ${r.status} em ${caminho.split('?')[0]}`);
  return r.json();
}
async function todos(caminho) {
  const itens = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    const j = await api(`${caminho}${caminho.includes('?') ? '&' : '?'}limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`);
    itens.push(...(j.data || []));
    if (!j.meta?.has_next_page) break;
    cursor = j.meta.end_cursor;
  }
  return itens;
}

(async () => {
  const simular = process.argv.includes('--simular');
  if (!CHAVE) throw new Error('FACTORIAL_API_KEY não configurada: a busca na Factorial não roda.');
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (ROBO_DATABASE_URL).');
  const sql = neon(url);
  const linhas = await sql.query(`select id, doc_id, nome, cpf, competencia from documentos
    where aba is not null and estado = 'PENDENTE_ENVIO' and doc_id = any($1) order by id`, [Object.keys(REGRAS).map(Number)]);
  log(`Busca na Factorial: ${linhas.length} pendência(s) de arquivo único esperando documento.`);
  const relatorio = { em: new Date().toISOString(), itens: [] };
  if (linhas.length) {
    const pastas = Object.fromEntries((await todos('/documents/folders')).map((f) => [String(f.id), f.name]));
    const funcionarios = await todos('/employees/employees');
    const docsDe = new Map();
    for (const l of linhas) {
      const r = { id: l.id, doc_id: l.doc_id, nome: l.nome, competencia: l.competencia };
      relatorio.itens.push(r);
      const cpf = digitos(l.cpf);
      const f = cpf.length === 11 ? funcionarios.filter((e) => digitos(e.identifier) === cpf || digitos(e.social_security_number) === cpf) : [];
      if (f.length !== 1) { r.achou = false; r.motivo = f.length ? `${f.length} funcionários com o mesmo CPF na Factorial` : 'funcionário não encontrado na Factorial pelo CPF'; continue; }
      if (!docsDe.has(f[0].id)) docsDe.set(f[0].id, (await todos(`/documents/documents?employee_ids[]=${f[0].id}`)).filter((d) => !d.deleted_at));
      const regra = REGRAS[l.doc_id];
      const cand = docsDe.get(f[0].id).filter((d) => regra.pastas.test(normalizar(pastas[String(d.folder_id)])) && regra.achar(normalizar(d.filename)));
      const aptos = cand.filter((d) => ASSINATURA_OK.has(d.signature_status) && /^\.?pdf$/i.test(String(d.extension || path.extname(d.filename))));
      if (aptos.length !== 1) {
        r.achou = false;
        r.motivo = !cand.length ? 'nenhum arquivo deste tipo na Factorial' : !aptos.length ? 'arquivo achado, mas não é PDF ou falta assinatura'
          : `${aptos.length} arquivos possíveis (${aptos.map((d) => d.id).join(', ')}): alguém escolhe`;
        continue;
      }
      const d = aptos[0];
      Object.assign(r, { achou: true, factorial_id: d.id, pasta: pastas[String(d.folder_id)] || null, criado: String(d.created_at || '').slice(0, 10) });
      if (simular) { r.motivo = 'simulação: não baixado'; continue; }
      const link = await api('/documents/download_urls/bulk_create', { method: 'POST', body: JSON.stringify({ ids: [Number(d.id)] }) }).then((x) => (x.data || x)[0]);
      const res = await fetch(link.url); // link temporário: sem a chave no cabeçalho
      if (!res.ok) { r.achou = false; r.motivo = `download falhou (HTTP ${res.status})`; continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') { r.achou = false; r.motivo = 'o arquivo baixado não é PDF'; continue; }
      fs.mkdirSync(PASTA, { recursive: true, mode: 0o700 });
      const arq = path.join(PASTA, `${d.id}.pdf`);
      fs.writeFileSync(arq, buf, { mode: 0o600 });
      // No container o robô é root e o painel (1000) lê este arquivo: fica com o dono da pasta, senão o painel não abre.
      try { const { uid, gid } = fs.statSync(PASTA); fs.chownSync(arq, uid, gid); } catch {}
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      // O mesmo arquivo já na pendência de outro funcionário = anexado na pessoa errada na Factorial (19/10: o mesmo "eSocial.pdf" em 4 pessoas).
      const outros = (await sql.query('select id, cpf from documentos where hash_arquivo = $1 and id <> $2', [hash, l.id])).filter((x) => digitos(x.cpf) && digitos(x.cpf) !== cpf);
      if (outros.length) { r.achou = false; r.motivo = `o mesmo arquivo já está na pendência de outro funcionário (#${outros.map((x) => x.id).join(', #')}): conferir na Factorial em quem ele foi anexado`; continue; }
      // Só avança quem ainda está PENDENTE_ENVIO (se outro processo mexeu no meio, não sobrescreve).
      await sql.query(`update documentos set estado = 'LOCALIZADO', caminho_origem = $2, tamanho_bytes = $3, hash_arquivo = $4, atualizado_em = now()
        where id = $1 and estado = 'PENDENTE_ENVIO'`, [l.id, `factorial:${d.id}`, buf.length, hash]);
      r.paginas = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      log(`#${l.id} ${l.nome} (${l.competencia}): achado na Factorial ${d.id} (${r.pasta}), ${buf.length} bytes -> LOCALIZADO`);
    }
  }
  const achados = relatorio.itens.filter((x) => x.achou).length;
  for (const x of relatorio.itens.filter((i) => !i.achou)) log(`#${x.id} ${x.nome} (${x.competencia}): ${x.motivo}`);
  log(`Busca na Factorial: ${achados} achado(s), ${relatorio.itens.length - achados} sem documento${simular ? ' (simulação: nada gravado)' : ''}.`);
  fs.mkdirSync(path.dirname(ARQ_BUSCA), { recursive: true });
  fs.writeFileSync(ARQ_BUSCA, JSON.stringify(relatorio, null, 2), 'utf8');
})().catch((e) => {
  console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exitCode = 1;
});
