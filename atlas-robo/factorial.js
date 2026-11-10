// Busca na Factorial os documentos das pendências do Atlas (SOMENTE LEITURA na Factorial) e deixa prontos para o enviar.js.
//
// Pasta e arquivo são reconhecidos pelas PALAVRAS do nome (regras-factorial.js), não pelo nome exato (03/11).
// ARQUIVO ÚNICO (LOCALIZADO, caminho_origem "factorial:<id>"):
//   67 ASO demissional · 68 baixa na CTPS/eSocial · 69 pedido de demissão   (só para colaborador com data de desligamento)
//   78 ASO admissional/periódico (1 arquivo no período) · 79 ficha de registro · 80 comprovante de registro eSocial (onboarding;
//   78/79/80 não valem para quem já saiu) · 83 cartão de ponto (1 PDF do colaborador no mês)   (todos estes: ligados por padrão)
// Antes de gravar, o PDF baixado passa pela conferência do conteúdo (conteudo.js): CPF de outra pessoa, outro documento, dado clínico.
// VÁRIAS PEÇAS, unidas pelo Gotenberg na ordem (COMPOSTO, caminho_origem "factorial:unido-<doc>-<id do Neon>"):
//   8 férias: recibo (ou o aviso, que vale como recibo: Milena, 06/11) → comprovante · 9 TRCT: TRCT → termo de quitação → comprovante
//   (ou só o comprovante, pelo nome do Atlas) · 10 GFD rescisória: guia do FGTS → comprovante
// 09/11: o 8 passou para este robô (ligado por padrão) e saiu da sincronização do Evilásio (SINC_DOCS = 9,10). As montagens do 8
// saem SEGURADAS (out/envio/segurar.json) até o usuário conferir e soltar. O 9 e o 10 continuam da sincronização (DESLIGADOS aqui):
//   node factorial.js --simular --docs 9,10        (ou FACTORIAL_DOCS=...). Só um dono por documento: ligar aqui = desligar lá.
//
// Para cada linha do robô no Neon com estado PENDENTE_ENVIO e um desses doc_id:
//   acha o funcionário pelo CPF (tem que ser exatamente 1), lista os documentos dele e aplica a regra;
//   achou tudo (e só 1 arquivo por peça) = baixa em out/downloads/factorial-docs/<id Factorial>.pdf (a união vira unido-<doc>-<id>.pdf) e grava no Neon;
//   0 ou mais de 1 arquivo para uma peça, peça sem assinatura (TRCT/quitação), peça fora do período = não mexe no Neon e só registra
//   o motivo em out/envio/busca.json (o painel mostra; sem nomes de arquivo, só ids).
// Uso: node factorial.js [--simular] [--docs 8,9,10]   Variáveis: FACTORIAL_API_KEY (obrigatória), FACTORIAL_API_URL, ROBO_DATABASE_URL, GOTENBERG_URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { conexao } = require('./neon');
const { OUT, log } = require('./comum');
const { unirPdfs } = require('./unir-pdfs');
const rf = require('./regras-factorial');
const { conferirConteudo } = require('./conteudo');
const lerPdf = require('./ler-pdf');

const API = (process.env.FACTORIAL_API_URL || 'https://api.factorialhr.com/api/2026-07-01/resources').replace(/\/$/, '');
const CHAVE = (process.env.FACTORIAL_API_KEY || '').trim();
const PASTA = path.join(process.env.FACTORIAL_PASTA_DOWNLOAD || path.join(OUT, 'downloads'), 'factorial-docs');
const ARQ_BUSCA = path.join(OUT, 'envio', 'busca.json');

const normalizar = rf.normalizar;
const digitos = (s) => String(s || '').replace(/\D/g, '');
const REGRAS = rf.UNICOS; // documentos de arquivo único (nome mantido para o teste e para quem lia daqui)
const COMPOSTOS = [8, 9, 10]; // várias peças
const PADRAO = [67, 68, 69, 78, 79, 80, 83, 8];
// Tipos novos neste robô: o que ele montar sai segurado (o envio automático pula) até o usuário conferir o PDF e soltar no painel.
const SEGURAR_DOCS = { 8: 'férias pela regra nova da Milena (06/11: o aviso vale como recibo), 1ª vez neste robô' };
const ARQ_SEGURAR = path.join(OUT, 'envio', 'segurar.json');
function segurar(itens) {
  if (!itens.length) return 0;
  let seg = {};
  try { seg = JSON.parse(fs.readFileSync(ARQ_SEGURAR, 'utf8')) || {}; } catch {}
  let n = 0;
  for (const { id, doc } of itens) {
    if (seg[id]) continue;
    seg[id] = { motivo: `${SEGURAR_DOCS[doc]}: conferir o PDF na ficha e soltar`, em: new Date().toISOString(), auto: true };
    n++;
  }
  if (!n) return 0;
  fs.mkdirSync(path.dirname(ARQ_SEGURAR), { recursive: true });
  const tmp = ARQ_SEGURAR + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(seg, null, 2), 'utf8');
  try { const { uid, gid } = fs.statSync(path.dirname(ARQ_SEGURAR)); fs.chownSync(tmp, uid, gid); } catch {}
  fs.renameSync(tmp, ARQ_SEGURAR);
  return n;
}
const aSegurar = [];
const ASSINATURA_OK = rf.ASSINATURA_OK;

// Quais documentos buscar: --docs 8,9,10 ou FACTORIAL_DOCS; padrão 67,68,69. Número sem regra é recusado (não ignora em silêncio).
function docsLigados(argv = process.argv, env = process.env) {
  const i = argv.indexOf('--docs');
  const bruto = i >= 0 ? argv[i + 1] : env.FACTORIAL_DOCS;
  if (!bruto) return PADRAO;
  const lista = String(bruto).split(',').map((x) => Number(x.trim())).filter(Boolean);
  const invalidos = lista.filter((d) => !REGRAS[d] && !COMPOSTOS.includes(d));
  if (invalidos.length || !lista.length) throw new Error(`--docs com número sem regra na Factorial: ${invalidos.join(', ') || bruto}. Valem: ${[...Object.keys(REGRAS), ...COMPOSTOS].join(', ')}.`);
  return [...new Set(lista)];
}

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

// Baixa um documento da Factorial em PASTA/<id>.pdf. Devolve { buf, arq } ou { erro }.
async function baixar(d) {
  const link = await api('/documents/download_urls/bulk_create', { method: 'POST', body: JSON.stringify({ ids: [Number(d.id)] }) }).then((x) => (x.data || x)[0]);
  const res = await fetch(link.url); // link temporário: sem a chave no cabeçalho
  if (!res.ok) return { erro: `download falhou (HTTP ${res.status})` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { erro: 'o arquivo baixado não é PDF' };
  fs.mkdirSync(PASTA, { recursive: true, mode: 0o700 });
  const arq = path.join(PASTA, `${d.id}.pdf`);
  fs.writeFileSync(arq, buf, { mode: 0o600 });
  // No container o robô é root e o painel (1000) lê este arquivo: fica com o dono da pasta, senão o painel não abre.
  try { const { uid, gid } = fs.statSync(PASTA); fs.chownSync(arq, uid, gid); } catch {}
  return { buf, arq };
}
const paginas = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

module.exports = { REGRAS, COMPOSTOS, PADRAO, docsLigados, normalizar };

if (require.main === module) (async () => {
  const simular = process.argv.includes('--simular');
  const docs = docsLigados();
  if (!CHAVE) throw new Error('FACTORIAL_API_KEY não configurada: a busca na Factorial não roda.');
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (ROBO_DATABASE_URL).');
  const sql = neon(url);
  // Só PENDENTE_ENVIO é gravado. Na simulação dos compostos também aparecem os estados que a sincronização do Evilásio põe
  // (para comparar o resultado das duas buscas lado a lado).
  const DA_SINC = ['NAO_ENCONTRADO_FACTORIAL', 'AGUARDANDO_ASSINATURA', 'ERRO_COMPOSICAO'];
  const estados = simular ? ['PENDENTE_ENVIO', ...DA_SINC] : ['PENDENTE_ENVIO'];
  // Tipos que este robô assumiu da sincronização (8, em 09/11): as pendências que ela deixou num estado de "não achou" voltam a ser
  // buscadas aqui; se agora fecharem, avançam a partir do estado em que estavam.
  const ASSUMIDOS = Object.keys(SEGURAR_DOCS).map(Number).filter((d) => docs.includes(d));
  const linhas = await sql.query(`select id, doc_id, nome, cpf, competencia, estado from documentos
    where aba is not null and doc_id = any($2) and (estado = any($1) or (doc_id = any($3) and estado = any($4))) order by id`,
  [estados, docs, ASSUMIDOS, DA_SINC]);
  log(`Busca na Factorial (docs ${docs.join(', ')}): ${linhas.length} pendência(s) esperando documento.`);
  const relatorio = { em: new Date().toISOString(), docs, itens: [] };
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
      const lista = docsDe.get(f[0].id);
      // Colaborador ativo/desligado (Milena: "conferir se o funcionário está ativo") e pedidos que ela manda desconsiderar.
      const regraU = REGRAS[l.doc_id];
      if (regraU) {
        const ign = regraU.ignorar?.(l);
        if (ign) { r.achou = false; r.motivo = ign; continue; }
        const srv = rf.colaboradorServe(regraU, f[0]);
        if (!srv.ok) { r.achou = false; r.motivo = srv.motivo; continue; }
        if (regraU.colaborador && srv.situacao === null) r.aviso = 'a Factorial não informou se o colaborador está ativo ou desligado: situação não conferida';
      }

      // ---- escolha do que vai no PDF
      let partes; // [{ papel, d }]
      if (COMPOSTOS.includes(l.doc_id)) {
        const e = rf.escolherPartes(l.doc_id, l.nome, l.competencia, lista, pastas);
        if (!e.ok) { r.achou = false; r.motivo = e.motivo; if (e.aguardando) r.aguardando_assinatura = true; continue; }
        partes = e.partes;
        if (e.avisos.length) r.aviso = e.avisos.join('; ');
      } else {
        const regra = REGRAS[l.doc_id];
        const esc = rf.escolherUnico(regra, lista, pastas, l.competencia);
        if (!esc.ok) { r.achou = false; r.motivo = esc.motivo; continue; }
        if (esc.semTipo) r.sem_tipo_no_nome = true; // confirmado pelo texto depois de baixar
        partes = [{ papel: 'unico', d: esc.d }];
        if (regra.aviso) r.aviso = [r.aviso, regra.aviso].filter(Boolean).join('; ');
      }
      const unido = partes.length > 1 || COMPOSTOS.includes(l.doc_id);
      Object.assign(r, { achou: true, unido, factorial_id: partes[0].d.id, pasta: pastas[String(partes[0].d.folder_id)] || null, criado: String(partes[0].d.created_at || '').slice(0, 10),
        partes: partes.map((p) => ({ papel: p.papel, factorial_id: p.d.id, pasta: pastas[String(p.d.folder_id)] || null, criado: String(p.d.created_at || '').slice(0, 10) })) });
      if (simular) { r.motivo = 'simulação: não baixado'; continue; }

      // ---- baixa, une e grava
      const baixados = [];
      let falha = null;
      for (const p of partes) { const b = await baixar(p.d); if (b.erro) { falha = `${p.papel === 'unico' ? 'arquivo' : p.papel}: ${b.erro}`; break; } baixados.push(b); }
      if (falha) { r.achou = false; r.motivo = falha; continue; }
      let buf, caminho, estadoNovo;
      if (unido) {
        const nome = `unido-${l.doc_id}-${l.id}`;
        try { await unirPdfs({ arquivos: baixados.map((b) => b.arq), nome, saida: PASTA, substituir: true }); }
        catch (e) { r.achou = false; r.motivo = `não uniu as partes: ${e.message}`; continue; }
        const arq = path.join(PASTA, `${nome}.pdf`);
        try { const { uid, gid } = fs.statSync(PASTA); fs.chownSync(arq, uid, gid); fs.chmodSync(arq, 0o600); } catch {}
        buf = fs.readFileSync(arq); caminho = `factorial:${nome}`; estadoNovo = 'COMPOSTO';
      } else { buf = baixados[0].buf; caminho = `factorial:${partes[0].d.id}`; estadoNovo = 'LOCALIZADO'; }
      // Conteúdo do PDF (conteudo.js): CPF de outra pessoa, outro documento, dado clínico no ASO, recusa. Só bloqueia; PDF imagem passa.
      const arqFinal = unido ? path.join(PASTA, `unido-${l.doc_id}-${l.id}.pdf`) : baixados[0].arq;
      if (r.sem_tipo_no_nome) {
        const semTipo = rf.confirmarSemTipo(REGRAS[l.doc_id], await lerPdf.lerTexto(arqFinal), lerPdf.casaGrupos);
        if (semTipo) { r.achou = false; r.motivo = semTipo; continue; }
      }
      const cont = await conferirConteudo(arqFinal, { doc_id: l.doc_id, nome: l.nome, cpf: l.cpf, competencia: l.competencia });
      if (cont?.bloqueio) { r.achou = false; r.motivo = `conteúdo: ${cont.bloqueio}`; continue; }
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      // O mesmo arquivo já na pendência de outro funcionário = anexado na pessoa errada na Factorial (19/10: o mesmo "eSocial.pdf" em 4 pessoas).
      const outros = (await sql.query('select id, cpf from documentos where hash_arquivo = $1 and id <> $2', [hash, l.id])).filter((x) => digitos(x.cpf) && digitos(x.cpf) !== cpf);
      if (outros.length) { r.achou = false; r.motivo = `o mesmo arquivo já está na pendência de outro funcionário (#${outros.map((x) => x.id).join(', #')}): conferir na Factorial em quem ele foi anexado`; continue; }
      // Só avança quem ainda está no estado lido (PENDENTE_ENVIO, ou o "não achou" da sincronização nos tipos assumidos):
      // se outro processo mexeu no meio, não sobrescreve.
      await sql.query(`update documentos set estado = $5, caminho_origem = $2, tamanho_bytes = $3, hash_arquivo = $4, atualizado_em = now()
        where id = $1 and estado = $6`, [l.id, caminho, buf.length, hash, estadoNovo, l.estado]);
      r.paginas = paginas(buf);
      if (SEGURAR_DOCS[l.doc_id]) aSegurar.push({ id: l.id, doc: l.doc_id });
      log(`#${l.id} ${l.nome} (${l.competencia}): achado na Factorial (${partes.length} peça(s)), ${buf.length} bytes -> ${estadoNovo}`);
    }
  }
  const nSeg = segurar(aSegurar);
  if (nSeg) log(`${nSeg} pendência(s) de tipo novo neste robô ficaram SEGURADAS (conferir o PDF no painel e soltar).`);
  const achados = relatorio.itens.filter((x) => x.achou).length;
  for (const x of relatorio.itens.filter((i) => !i.achou)) log(`#${x.id} ${x.nome} (${x.competencia}): ${x.motivo}`);
  log(`Busca na Factorial: ${achados} achado(s), ${relatorio.itens.length - achados} sem documento${simular ? ' (simulação: nada gravado)' : ''}.`);
  fs.mkdirSync(path.dirname(ARQ_BUSCA), { recursive: true });
  fs.writeFileSync(ARQ_BUSCA, JSON.stringify(relatorio, null, 2), 'utf8');
})().catch((e) => {
  console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exitCode = 1;
});
