// Envio ao Atlas. Sem --enviar é SIMULAÇÃO: não anexa arquivo e não clica em "Salvar e enviar".
//
// O que faz:
//   1. Lê do Neon as pendências do robô (aba preenchida) em COMPOSTO ou LOCALIZADO.
//   2. Acha o document_schedule_id de cada uma na última coleta local (out/atlas.db), pela mesma chave do neon.js.
//   3. Localiza o arquivo em disco (caminho_origem, ou <pasta>/factorial/<id>/... se o caminho veio de outra máquina)
//      e confere extensão (.pdf/.zip, o que o portal aceita), tamanho e SHA-256 contra o que está no Neon.
//   4. Mostra o que enviaria e grava out/enviar-simulacao.json.
//   5. Com --abrir [N], abre a tela de envio das N primeiras com document_schedule_id (prontas primeiro; padrão 1) só para conferir que é o documento certo,
//      que existe o campo de arquivo e que "Salvar e enviar" está desabilitado. Não anexa nada.
//
// Uso:
//   node enviar.js                    lista
//   node enviar.js --id 129           só essa pendência do Neon
//   node enviar.js --abrir 3          lista e abre a tela das 3 primeiras prontas
// Opções: --pasta <raiz dos downloads> (padrão FACTORIAL_PASTA_DOWNLOAD ou out/downloads)
//
// ENVIO DE VERDADE (só com aprovação, UMA pendência por vez):
//   node enviar.js --enviar --id 119 --confirmo <document_schedule_id>
//   O --confirmo tem que ser o document_schedule_id que a simulação mostrou para esse --id: é a pessoa confirmando o local exato.
//   Antes de enviar, consulta a pendência AGORA no Atlas (enc/document-schedules/<id>/general-information) e para se o nome
//   não for o mesmo do Neon, se o status não for atrasada/pendente, se o upload não for permitido ou se o formato não aceitar PDF.
//   O envio é o mesmo do botão "Salvar e enviar": POST enc/document-files/upload (multipart: json + file).
//   Depois confere o status de novo e grava ENVIADO/enviado_em no Neon. Tudo vai para out/envios.log.
//
//   node enviar.js --verificar --id 119   faz só a conferência no Atlas (nada é anexado) e diz se pode enviar
//   node enviar.js --auto [--max N]       ENVIA todas as prontas, uma por vez (botão "envio automático" do painel, via robo.js);
//                                         pula a que der erro e segue com as outras. Padrão: até ENVIO_MAX_POR_RODADA (30) por rodada.
//   O resultado da última ação de cada pendência vai para out/envio/resultados.json (o painel mostra).
//   --enviar e --auto só enviam com o interruptor "Envio liberado" LIGADO no painel (out/envio/modo.json liberado: true;
//   sem o arquivo = bloqueado). Pendência segurada no painel (out/envio/segurar.json) nunca fica pronta.
//   PDF montado nesta máquina (COMPOSTO com caminho de outra máquina): o tamanho/SHA-256 do Neon são do arquivo antigo e
//   não são comparados; ao enviar, o Neon passa a guardar os do arquivo enviado.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { DatabaseSync } = require('node:sqlite');
const { conexao } = require('./neon');
const { APP, GATEWAY, OUT, log, abrir, garantirLogin, esperarToken, api, dormir } = require('./comum');

const DB = process.env.ATLAS_DB || path.join(__dirname, 'out', 'atlas.db');
const AMBIGUA = Symbol('ambígua');
const ACEITA = new Set(['.pdf', '.zip']);

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
const digitos = (s) => (s ? String(s).replace(/\D/g, '') : '');
const dia = (d) => (d == null ? '' : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
// Mesma pendência entre Neon e coleta local: documento, CPF, CNPJ, pedido, unidade, competência e prazo.
const chave = (r) => [normalizar(r.nome), digitos(r.cpf), digitos(r.cnpj_filial), r.pedido, normalizar(r.unidade), r.competencia, dia(r.prazo_envio)].join('|');

function idsDaColeta() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const coleta = db.prepare('SELECT id FROM coletas ORDER BY id DESC LIMIT 1').get();
  if (!coleta) throw new Error('Nenhuma coleta no banco local. Rode node pendencias.js antes.');
  const linhas = db.prepare(`SELECT documento, cpf, cnpj_filial, pedido, unidades, competencia, prazo_envio, document_schedule_id, status FROM pendencias WHERE coleta_id = ? AND aba <> 'Reprovados'`).all(coleta.id);
  db.close();
  // Chave que aparece com mais de um document_schedule_id fica AMBÍGUA (null): melhor não enviar do que enviar no lugar errado.
  const mapa = new Map();
  const status = new Map();
  for (const l of linhas) {
    const k = chave({ nome: l.documento, cpf: l.cpf, cnpj_filial: l.cnpj_filial, pedido: l.pedido, unidade: l.unidades, competencia: l.competencia, prazo_envio: l.prazo_envio });
    mapa.set(k, mapa.has(k) && mapa.get(k) !== l.document_schedule_id ? AMBIGUA : l.document_schedule_id);
    status.set(l.document_schedule_id, l.status);
  }
  return { mapa, status, coletaId: coleta.id };
}

// Só sai pendência atrasada ou pendente SEM arquivo no Atlas (coleta: DelayNotSent/PendingNotSent; general-information: Delay/Pending).
// Reprovada (DelayRejected) ainda tem o arquivo antigo: o Atlas só aceita outro depois que a equipe exclui esse na tela, e
// responde 22006 "Documento já importado!" (ficha 01 de 27/10; em 28/10 o automático tentou 7 reprovadas do PI).
const STATUS_ENVIAVEL = /^(Delay|Pending)(NotSent)?$/i;
const PRECISA_PORTAL = 'precisa de ação no portal';
const motivoStatus = (s) => (/Rejected/i.test(s || '')
  ? `${PRECISA_PORTAL}: reprovada no Atlas (${s}); excluir o arquivo antigo no portal antes de reenviar`
  : `${PRECISA_PORTAL}: status no Atlas "${s}" (só envio atrasada/pendente sem arquivo)`);
const JA_IMPORTADO = /"code":\s*22006/;

// Caminho gravado por outra máquina (ex.: "downloads\factorial\120\doc9_...pdf") vira <pasta>/factorial/120/doc9_...pdf.
// original = é o mesmo arquivo que o Neon descreve (então tamanho e SHA-256 do Neon valem para ele).
function acharArquivo(caminho, pasta, id) {
  if (!caminho) return { erro: 'sem caminho_origem' };
  // LOCALIZADO: a sincronização grava "factorial:<id do documento>"; o arquivo baixado fica em <pasta>/factorial-docs/<id>.<ext>.
  const fid = /^factorial:(\d+)$/i.exec(caminho);
  if (fid) {
    const dir = path.join(pasta, 'factorial-docs');
    const achado = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.startsWith(fid[1] + '.'));
    return achado ? { arquivo: path.join(dir, achado), original: true } : { erro: `ainda não baixado da Factorial (${fid[1]})` };
  }
  // SharePoint (sharepoint.js --gravar): "sharepoint:<id do item>" ou "sharepoint:unido-<chave>", baixado em <pasta>/sharepoint/<...>.pdf.
  const sid = /^sharepoint:([\w!.\-]+)$/i.exec(caminho);
  if (sid) {
    const arq = path.join(pasta, 'sharepoint', `${sid[1]}.pdf`);
    return fs.existsSync(arq) && fs.statSync(arq).isFile() ? { arquivo: arq, original: true } : { erro: `ainda não baixado do SharePoint (${sid[1]})` };
  }
  if (fs.existsSync(caminho) && fs.statSync(caminho).isFile()) return { arquivo: caminho, original: true };
  // Montado de novo nesta máquina, na pasta do id do Neon (mesmas partes da Factorial, outro arquivo: o SHA-256 muda).
  const norm = caminho.replace(/\\/g, '/');
  const candidatos = [];
  const i = norm.toLowerCase().indexOf('factorial/');
  if (i >= 0) candidatos.push(path.join(pasta, ...norm.slice(i).split('/')));
  if (id != null) candidatos.push(path.join(pasta, 'factorial', String(id), path.basename(norm)));
  candidatos.push(path.join(pasta, path.basename(norm)));
  for (const c of candidatos) if (fs.existsSync(c) && fs.statSync(c).isFile()) return { arquivo: c, original: false };
  return { erro: 'arquivo não encontrado neste computador' };
}

function conferir(arquivo, linha, original) {
  const ext = path.extname(arquivo).toLowerCase();
  const dados = fs.readFileSync(arquivo);
  const hash = crypto.createHash('sha256').update(dados).digest('hex');
  const avisos = [];
  if (!ACEITA.has(ext)) avisos.push(`extensão ${ext || '(nenhuma)'} não aceita pelo portal`);
  if (ext === '.pdf' && dados.subarray(0, 5).toString('latin1') !== '%PDF-') avisos.push('não parece um PDF');
  if (original && linha.tamanho_bytes != null && Number(linha.tamanho_bytes) !== dados.length) avisos.push(`tamanho difere do Neon (${dados.length} x ${linha.tamanho_bytes})`);
  if (original && linha.hash_arquivo && linha.hash_arquivo !== hash) avisos.push('SHA-256 difere do Neon');
  return { tamanho: dados.length, hash, avisos, montado_aqui: !original };
}

// Abre a tela de envio e confere, sem anexar nada.
async function abrirTela(prontas) {
  const { ctx, page } = await abrir();
  const res = [];
  try {
    await garantirLogin(page, '/dashboard/provider');
    for (const p of prontas) {
      await page.goto(`${APP}/document-schedule/${p.schedule_id}/general-information?resume=false`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 30000 }).catch(() => {});
      await dormir(1500);
      const titulo = (await page.locator('text=/^Documento - /').first().innerText().catch(() => '')).replace(/^Documento - /, '').trim();
      const campoArquivo = await page.locator('input[type=file]').count();
      const botao = page.locator('button:has-text("Salvar e enviar")').first();
      const achouBotao = (await botao.count()) > 0;
      const classeBotao = achouBotao ? (await botao.getAttribute('class', { timeout: 3000 }).catch(() => '')) || '' : '';
      const desabilitado = achouBotao ? (/disabled/.test(classeBotao) || (await botao.isDisabled().catch(() => false))) : null;
      const r = { id: p.id, titulo_portal: titulo, documento_neon: p.nome, titulo_confere: normalizar(titulo) === normalizar(p.nome), campo_arquivo: campoArquivo > 0, botao_encontrado: achouBotao, botao_desabilitado: desabilitado };
      log(`Tela ${p.id}: "${titulo}" | confere: ${r.titulo_confere} | campo de arquivo: ${r.campo_arquivo} | botão desabilitado: ${r.botao_desabilitado}`);
      res.push(r);
    }
  } finally {
    await ctx.close();
  }
  return res;
}

// Liberação do envio: só o painel decide. Lida antes de cada envio, então desligar no painel para o automático na próxima pendência.
const DIR_ENVIO = path.join(OUT, 'envio');
const lerEnvio = (nome) => { try { return JSON.parse(fs.readFileSync(path.join(DIR_ENVIO, nome), 'utf8')) || {}; } catch { return {}; } };
const liberado = () => lerEnvio('modo.json').liberado === true;
const BLOQUEADO = 'envio bloqueado no painel (interruptor "Envio liberado" desligado): nada foi enviado';
const registro = (m) => { log(m); fs.mkdirSync(OUT, { recursive: true }); fs.appendFileSync(path.join(OUT, 'envios.log'), `[${new Date().toISOString()}] ${m}\n`, 'utf8'); };
// Última ação em cada pendência (verificar/enviar), para o painel mostrar na aba Envio. Sem nome de arquivo (tem CPF).
const ARQ_RESULTADOS = path.join(OUT, 'envio', 'resultados.json');
function resultado(id, r) {
  let t = {};
  try { t = JSON.parse(fs.readFileSync(ARQ_RESULTADOS, 'utf8')); } catch {}
  t[id] = { ...r, em: new Date().toISOString() };
  fs.mkdirSync(path.dirname(ARQ_RESULTADOS), { recursive: true });
  fs.writeFileSync(ARQ_RESULTADOS, JSON.stringify(t, null, 2), 'utf8');
}

// Atlas respondeu "já importado" (22006): a pendência é segurada sozinha (mesmo segurar.json do botão do painel), para não
// ser tentada a cada rodada. Volta a sair quando alguém clicar em Soltar, depois de excluir o arquivo antigo no portal.
function segurarJaImportado(id, msg) {
  if (!JA_IMPORTADO.test(msg)) return false;
  const seg = lerEnvio('segurar.json');
  if (seg[id]) return false;
  seg[id] = { motivo: 'já importado no Atlas (22006): excluir o arquivo antigo no portal e soltar', em: new Date().toISOString(), auto: true };
  fs.mkdirSync(DIR_ENVIO, { recursive: true });
  fs.writeFileSync(path.join(DIR_ENVIO, 'segurar.json'), JSON.stringify(seg, null, 2), 'utf8');
  registro(`#${id} segurada sozinha: o Atlas respondeu "já importado" (22006).`);
  return true;
}

// Abre o portal, garante o login e o token, roda fn(ctx) e fecha. Uma sessão serve para várias pendências.
async function comSessao(fn) {
  const { ctx, page } = await abrir();
  try {
    await garantirLogin(page, '/dashboard/provider');
    await esperarToken(ctx);
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}

// Consulta a pendência AGORA no Atlas e diz o que impediria o envio. Não anexa nada.
async function conferirNoAtlas(ctx, item) {
  const antes = await api(ctx, `enc/document-schedules/${item.schedule_id}/general-information`).then((r) => r.data || r);
  const problemas = [];
  if (normalizar(antes.name) !== normalizar(item.nome)) problemas.push(`nome no Atlas "${antes.name}" diferente do Neon "${item.nome}"`);
  if (!STATUS_ENVIAVEL.test(antes.status || '')) problemas.push(motivoStatus(antes.status));
  // allows_document_upload NÃO vale para nós: no JS do portal ele só decide o upload de usuário da organização (Equatorial);
  // fornecedor e admin sempre podem (canUploadDocuments = true). Vem false em todas as pendências da nossa conta (15/10).
  // A trava que vale é quem sobe o arquivo: só envia se a pendência for de envio manual pelo fornecedor.
  if (antes.type_upload !== 'ManualByProvider') problemas.push(`tipo de envio no Atlas "${antes.type_upload}" (só envio manual pelo fornecedor)`);
  const ext = item.arquivo ? path.extname(item.arquivo).toLowerCase().slice(1) : null;
  if (!ext) problemas.push('sem arquivo para enviar');
  else if (antes.file_format && !JSON.stringify(antes.file_format).toLowerCase().includes(ext)) problemas.push(`formato aceito ${JSON.stringify(antes.file_format)}, arquivo .${ext}`);
  registro(`#${item.id} schedule ${item.schedule_id}: Atlas "${antes.name}" status ${antes.status} envio ${antes.type_upload ?? '?'} formato ${JSON.stringify(antes.file_format ?? null)} tamanho máx ${JSON.stringify(antes.file_size ?? null)}; arquivo ${item.arquivo ? path.basename(item.arquivo) : '-'} ${item.tamanho ?? '-'} bytes`);
  return { antes, problemas };
}

// Envia UMA pendência ao local exato (document_schedule_id). Para sem enviar se qualquer conferência falhar.
async function enviarUma(ctx, item, sql) {
  if (!liberado()) throw new Error(BLOQUEADO);
  const { problemas } = await conferirNoAtlas(ctx, item);
  if (problemas.length) throw new Error('NÃO ENVIEI: ' + problemas.join('; '));
  const ext = path.extname(item.arquivo).toLowerCase().slice(1);
  const dados = fs.readFileSync(item.arquivo);
  const form = new FormData();
  form.append('json', JSON.stringify({ validity_date: null, document_schedule_id: item.schedule_id }));
  form.append('file', new Blob([dados], { type: ext === 'zip' ? 'application/zip' : 'application/pdf' }), path.basename(item.arquivo));
  const r = await fetch(new URL('enc/document-files/upload', GATEWAY), { method: 'POST', headers: { authorization: 'Bearer ' + ctx.token, accept: 'application/json' }, body: form });
  const corpo = (await r.text()).slice(0, 500);
  if (!r.ok) {
    // 81005: o portal pede aceite de um termo antes do envio. Não aceita sozinho: uma pessoa decide.
    const termo = /81005/.test(corpo) ? ' (o portal pediu aceite de termo: enviar pela tela)' : '';
    throw new Error(`Atlas recusou o envio: HTTP ${r.status}${termo} ${corpo}`);
  }
  const depois = await api(ctx, `enc/document-schedules/${item.schedule_id}/general-information`).then((x) => x.data || x).catch(() => ({}));
  registro(`#${item.id} ENVIADO ao schedule ${item.schedule_id}; status no Atlas agora: ${depois.status ?? '?'}`);
  // Tamanho e SHA-256 passam a ser os do arquivo que foi de fato enviado (o montado aqui, se for o caso).
  const hash = crypto.createHash('sha256').update(dados).digest('hex');
  await sql.query(`update documentos set estado = 'ENVIADO', enviado_em = now(), atualizado_em = now(), tamanho_bytes = $2, hash_arquivo = $3 where id = $1`, [item.id, dados.length, hash]);
  registro(`#${item.id} Neon: estado ENVIADO gravado.`);
  return depois.status ?? null;
}

(async () => {
  const args = process.argv.slice(2);
  const opc = {};
  for (let i = 0; i < args.length; i++) {
    if (['--enviar', '--verificar', '--auto'].includes(args[i])) opc[args[i].slice(2)] = true;
    else if (args[i] === '--abrir') opc.abrir = /^\d+$/.test(args[i + 1] || '') ? Number(args[++i]) : 1;
    else if (args[i].startsWith('--')) opc[args[i].slice(2)] = args[++i];
  }
  if (opc.enviar && !(opc.id && opc.confirmo)) {
    console.error('Envio de verdade: só uma pendência por vez, com --id <id do Neon> --confirmo <document_schedule_id mostrado na simulação>.');
    process.exitCode = 2;
    return;
  }
  if (opc.verificar && !opc.id) {
    console.error('--verificar precisa de --id <id do Neon>.');
    process.exitCode = 2;
    return;
  }
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (defina ROBO_DATABASE_URL ou ROBO_ENV_FILE).');
  const pasta = opc.pasta || process.env.FACTORIAL_PASTA_DOWNLOAD || path.join(__dirname, 'out', 'downloads');
  const { mapa, status: statusColeta, coletaId } = idsDaColeta();
  const filtro = opc.id ? 'and id = $2' : '';
  const linhas = await neon(url).query(
    `select id, doc_id, nome, cpf, cnpj_filial, numero_pedido, unidade, competencia, prazo_envio, estado, caminho_origem, tamanho_bytes, hash_arquivo
     from documentos where aba is not null and estado = any($1) ${filtro} order by id`,
    opc.id ? [['COMPOSTO', 'LOCALIZADO'], Number(opc.id)] : [['COMPOSTO', 'LOCALIZADO']],
  );

  // Seguradas no painel ({ "<id>": { motivo, em } }): arquivo conhecido como errado, não sai nem no automático.
  const segurar = lerEnvio('segurar.json');
  const itens = linhas.map((l) => {
    const item = { id: l.id, doc_id: l.doc_id, nome: l.nome, competencia: l.competencia, estado: l.estado, pronta: false, motivos: [] };
    item.schedule_id = mapa.get(chave({ ...l, pedido: l.numero_pedido })) || null;
    if (item.schedule_id === AMBIGUA) { item.schedule_id = null; item.motivos.push('mais de uma pendência do Atlas com a mesma chave (ambígua)'); }
    else if (!item.schedule_id) item.motivos.push(`sem document_schedule_id na coleta ${coletaId} (pendência não aparece mais ou mudou)`);
    const f = acharArquivo(l.caminho_origem, pasta, l.id);
    if (f.erro) item.motivos.push(f.erro);
    else {
      Object.assign(item, { arquivo: f.arquivo }, conferir(f.arquivo, l, f.original));
      item.motivos.push(...item.avisos);
    }
    item.pronta = !!item.schedule_id && !!item.arquivo && !item.avisos?.length;
    const st = item.schedule_id && statusColeta.get(item.schedule_id);
    if (st && !STATUS_ENVIAVEL.test(st)) { item.status_atlas = st; item.acao_portal = true; item.pronta = false; item.motivos.push(motivoStatus(st)); }
    const seg = segurar[l.id];
    if (seg) { item.segurada = true; item.pronta = false; item.motivos.push(`segurada no painel${seg.motivo ? ': ' + seg.motivo : ''}`); }
    return item;
  });
  // O mesmo arquivo em pendências de funcionários diferentes = arquivo errado em alguém (19/10: o mesmo "eSocial.pdf" de 23 páginas
  // anexado a 4 pessoas na Factorial, #269 #270 #273 #275): nenhuma sai até alguém conferir. Documento de empresa (sem CPF) pode repetir.
  const comHash = await neon(url).query('select id, cpf, hash_arquivo from documentos where hash_arquivo is not null and cpf is not null');
  for (const [i, item] of itens.entries()) {
    const cpf = digitos(linhas[i].cpf);
    if (!cpf) continue;
    const hashes = new Set([item.hash, linhas[i].hash_arquivo].filter(Boolean));
    const outros = comHash.filter((x) => x.id !== item.id && hashes.has(x.hash_arquivo) && digitos(x.cpf) !== cpf);
    if (!outros.length) continue;
    const m = `o mesmo arquivo está na pendência de outro funcionário (#${outros.map((x) => x.id).join(', #')}): conferir em quem ele foi anexado`;
    (item.avisos ||= []).push(m);
    item.motivos.push(m);
    item.pronta = false;
  }

  if (opc.verificar) {
    const item = itens[0];
    if (!item) { resultado(opc.id, { acao: 'verificar', ok: false, msg: 'não está COMPOSTO/LOCALIZADO no Neon' }); throw new Error(`#${opc.id} não está COMPOSTO/LOCALIZADO no Neon.`); }
    if (!item.schedule_id) { resultado(item.id, { acao: 'verificar', ok: false, msg: item.motivos.join('; ') }); throw new Error(`#${item.id}: ${item.motivos.join('; ')}`); }
    const { antes, problemas } = await comSessao((ctx) => conferirNoAtlas(ctx, item));
    const faltas = [...new Set([...(item.pronta ? [] : item.motivos), ...problemas])];
    resultado(item.id, { acao: 'verificar', ok: !faltas.length, status_atlas: antes.status ?? null, nome_atlas: antes.name ?? null, schedule_id: item.schedule_id,
      msg: faltas.length ? faltas.join('; ') : `pode enviar: Atlas "${antes.name}", status ${antes.status}` });
    log(faltas.length ? `#${item.id} NÃO pode enviar: ${faltas.join('; ')}` : `#${item.id} conferida no Atlas: pode enviar.`);
    if (faltas.length) process.exitCode = 4;
    return;
  }

  if (opc.enviar) {
    const item = itens[0];
    try {
      if (!liberado()) throw new Error(BLOQUEADO);
      if (!item) throw new Error(`#${opc.id} não está COMPOSTO/LOCALIZADO no Neon.`);
      if (!item.pronta) throw new Error(`#${item.id} não está pronta: ${item.motivos.join('; ')}`);
      if (item.schedule_id !== opc.confirmo) throw new Error(`--confirmo não confere: o local desta pendência é ${item.schedule_id}. Nada enviado.`);
      const status = await comSessao((ctx) => enviarUma(ctx, item, neon(url)));
      resultado(item.id, { acao: 'enviar', ok: true, status_atlas: status, schedule_id: item.schedule_id, msg: `ENVIADO; status no Atlas agora: ${status ?? '?'}` });
    } catch (e) {
      resultado(opc.id, { acao: 'enviar', ok: false, msg: String(e.message).slice(0, 400) });
      if (item) segurarJaImportado(item.id, String(e.message));
      throw e;
    }
    return;
  }

  // Envio automático (botão ligado no painel): todas as prontas, uma por vez, cada uma conferida no Atlas antes.
  // Pendência que dá erro é PULADA e a rodada segue com as outras (regra do usuário, 26/10: um arquivo com problema não para
  // a automação). O erro fica no resultado dela, para alguém olhar. Só para tudo se o envio for bloqueado no painel.
  // --max limita quantas por rodada.
  if (opc.auto) {
    if (!liberado()) { log(`Envio automático: ${BLOQUEADO}.`); process.exitCode = 6; return; }
    const max = Number(opc.max || process.env.ENVIO_MAX_POR_RODADA || 30);
    const fila = itens.filter((i) => i.pronta).slice(0, max);
    log(`Envio automático: ${fila.length} pronta(s) para enviar${itens.filter((i) => i.pronta).length > max ? ` (limite de ${max} por rodada)` : ''}.`);
    if (!fila.length) return;
    const sql = neon(url);
    let enviadas = 0, puladas = 0;
    await comSessao(async (ctx) => {
      for (const item of fila) {
        if (!liberado()) { registro(`Envio automático PAROU antes de #${item.id}: o envio foi bloqueado no painel.`); break; }
        try {
          const status = await enviarUma(ctx, item, sql);
          resultado(item.id, { acao: 'enviar', auto: true, ok: true, status_atlas: status, schedule_id: item.schedule_id, msg: `ENVIADO (automático); status no Atlas agora: ${status ?? '?'}` });
          enviadas++;
        } catch (e) {
          resultado(item.id, { acao: 'enviar', auto: true, ok: false, schedule_id: item.schedule_id, msg: String(e.message).slice(0, 400) });
          if (e.message === BLOQUEADO) { registro(`Envio automático PAROU em #${item.id}: ${e.message}`); break; }
          registro(`Envio automático PULOU #${item.id} e seguiu: ${e.message}`);
          segurarJaImportado(item.id, String(e.message));
          puladas++;
        }
      }
    });
    log(`Envio automático: ${enviadas} de ${fila.length} enviada(s)${puladas ? `, ${puladas} pulada(s)` : ''}.`);
    return;
  }

  const prontas = itens.filter((i) => i.pronta);
  log(`${itens.length} pendência(s) COMPOSTO/LOCALIZADO no Neon; ${prontas.length} pronta(s) para enviar; ${itens.length - prontas.length} com pendência de arquivo ou id.`);
  for (const i of itens) {
    const o = i.pronta ? 'PRONTA' : 'NÃO   ';
    console.log(`  ${o} #${i.id} ${i.estado} doc_id ${i.doc_id} ${i.nome} (${i.competencia}) local ${i.schedule_id || '?'}${i.pronta ? ` -> ${path.basename(i.arquivo)} ${i.tamanho} bytes` : ` -- ${i.motivos.join('; ')}`}`);
  }
  const porMotivo = {};
  for (const i of itens) if (!i.pronta) for (const m of i.motivos) porMotivo[m.replace(/\(.*\)/, '').trim()] = (porMotivo[m.replace(/\(.*\)/, '').trim()] || 0) + 1;
  if (Object.keys(porMotivo).length) log('Motivos: ' + Object.entries(porMotivo).map(([m, n]) => `${n}x ${m}`).join(' | '));

  let telas = [];
  if (opc.abrir) {
    // A conferência da tela não precisa do arquivo: abre as primeiras com document_schedule_id (prontas primeiro).
    const comTela = [...prontas, ...itens.filter((i) => !i.pronta && i.schedule_id)].slice(0, opc.abrir);
    if (!comTela.length) log('Nenhuma pendência com document_schedule_id; não abri o portal.');
    else telas = await abrirTela(comTela);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'enviar-simulacao.json'), JSON.stringify({ gerado_em: new Date().toISOString(), coleta: coletaId, pasta, itens, telas }, null, 2), 'utf8');
  log('Simulação: nada foi anexado nem enviado. Detalhes em out/enviar-simulacao.json');
})().catch((e) => {
  console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
  process.exitCode = e.codigo || 1;
});
