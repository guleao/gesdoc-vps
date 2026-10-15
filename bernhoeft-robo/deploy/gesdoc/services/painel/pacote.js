// Monta o pacote Bernhoeft de UM funcionário, para conferir antes de enviar:
//   1. acha o funcionário na Factorial (por nome ou CPF);
//   2. lista os documentos dele e separa os que vão para o Bernhoeft (doc_id 95 e 112 a 116 de documento_regras);
//   3. baixa, converte imagem/Word para PDF e une tudo num PDF só pelo Gotenberg, com uma capa
//      (o que foi achado, o que faltou, assinatura) na frente.
// SOMENTE LEITURA na Factorial e nada é enviado ao Bernhoeft. Os arquivos ficam em PACOTES/<id>-<nome>/.
// Uso: node pacote.js "Nome do Funcionário"     ou     node pacote.js 12345678900
// Variáveis: FACTORIAL_API_KEY (obrigatória), FACTORIAL_API_URL, GOTENBERG_URL, PACOTES.
const fs = require('fs');
const path = require('path');

const API = (process.env.FACTORIAL_API_URL || 'https://api.factorialhr.com/api/2026-07-01/resources').replace(/\/$/, '');
const CHAVE = (process.env.FACTORIAL_API_KEY || '').trim();
const GOTENBERG = (process.env.GOTENBERG_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
const PACOTES = process.env.PACOTES || path.join(__dirname, 'pacotes');

// Documentos que saem da Factorial e vão para o Bernhoeft (documento_regras, destino = Bernhoeft).
// A ordem aqui é a ordem no PDF. "achar" testa o nome do arquivo + nome da pasta, sem acento e em minúsculas.
const REGRAS = [
  { doc_id: 95, nome: 'Ficha de entrega de EPI', achar: /\bepi\b|equipamento de protecao|entrega de epi/ },
  { doc_id: 112, nome: 'Certificado de Direção Defensiva', achar: /direcao defensiva/ },
  { doc_id: 113, nome: 'Certificado de Qualificação', achar: /qualificacao/ },
  { doc_id: 114, nome: 'Certificado de Integração', achar: /integracao/ },
  { doc_id: 115, nome: 'Certificado de Primeiros Socorros', achar: /primeiros socorros/ },
  { doc_id: 116, nome: 'Treinamentos internos', achar: /treinamento|\bnr[ -]?\d{1,2}\b/ },
];
const CONVERTER = /^(png|jpe?g|gif|bmp|tiff?|webp|docx?|odt|rtf|xlsx?|ods|txt)$/i;

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');
const digitos = (s) => String(s || '').replace(/\D/g, '');
const cpfOculto = (s) => { const d = digitos(s); return d.length === 11 ? `***.***.${d.slice(6, 9)}-${d.slice(9)}` : '(sem CPF)'; };
const slug = (s) => normalizar(s).replace(/[^a-z0-9 ]/g, '').trim().replace(/ /g, '-').slice(0, 50) || 'sem-nome';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Factorial ----------
async function api(caminho, opts = {}) {
  if (!CHAVE) throw new Error('FACTORIAL_API_KEY não configurada.');
  let r;
  for (let t = 0; t < 4; t++) { // 429 = limite de chamadas: espera e tenta de novo
    r = await fetch(`${API}${caminho}`, {
      ...opts,
      headers: { 'x-api-key': CHAVE, accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    });
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  if (r.status === 401) throw new Error('Factorial respondeu 401: chave errada ou com espaço/quebra de linha.');
  if (!r.ok) throw new Error(`Factorial respondeu ${r.status} em ${caminho.split('?')[0]}`);
  return r.json();
}

// Lista paginada (cursor): segue end_cursor em after_id até has_next_page = false.
async function todos(caminho) {
  const itens = [];
  let cursor = null;
  for (let i = 0; i < 200; i++) {
    const sep = caminho.includes('?') ? '&' : '?';
    const j = await api(`${caminho}${sep}limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`);
    itens.push(...(j.data || []));
    if (!j.meta?.has_next_page) break;
    cursor = j.meta.end_cursor;
  }
  return itens;
}

async function acharFuncionario(busca) {
  const cpf = digitos(busca);
  let lista;
  if (cpf.length === 11) {
    lista = (await todos('/employees/employees')).filter((e) => digitos(e.identifier) === cpf || digitos(e.social_security_number) === cpf);
  } else {
    lista = await todos(`/employees/employees?full_text_name=${encodeURIComponent(busca)}`);
  }
  if (!lista.length) throw new Error(`Nenhum funcionário na Factorial para "${cpf.length === 11 ? cpfOculto(cpf) : busca}".`);
  if (lista.length > 1) {
    const nomes = lista.slice(0, 10).map((e) => `${e.full_name} (${cpfOculto(e.identifier)}${e.active === false ? ', desligado' : ''})`).join('; ');
    const e = new Error(`${lista.length} funcionários encontrados: ${nomes}. Use o nome completo ou o CPF.`);
    e.candidatos = lista.slice(0, 10).map((x) => ({ nome: x.full_name, cpf: cpfOculto(x.identifier), ativo: x.active !== false }));
    throw e;
  }
  return lista[0];
}

// ---------- Gotenberg ----------
async function gotenberg(rota, arquivos) {
  const form = new FormData();
  for (const [nome, buf, tipo] of arquivos) form.append('files', new Blob([buf], { type: tipo || 'application/octet-stream' }), nome);
  const r = await fetch(`${GOTENBERG}${rota}`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`Gotenberg ${rota} respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}
const ehPdf = (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-';
const paraPdf = (nome, buf) => gotenberg('/forms/libreoffice/convert', [[nome, buf]]);
// A capa vai pelo LibreOffice: o Chromium do Gotenberg da VPS está travado (--chromium-deny-list=^.*$).
const htmlParaPdf = (html) => paraPdf('capa.html', Buffer.from(html, 'utf8'));
// O merge une em ordem alfabética do nome: 001.pdf, 002.pdf, ...
const unir = (bufs) => gotenberg('/forms/pdfengines/merge', bufs.map((b, i) => [`${String(i + 1).padStart(3, '0')}.pdf`, b, 'application/pdf']));

function capa(func, itens, outros, gerado) {
  const linhas = itens.map((it) => it.arquivos.length
    ? it.arquivos.map((a, k) => `<tr>${k ? '<td></td>' : `<td><b>${it.doc_id}</b></td><td>${esc(it.nome)}</td>`}${k ? '<td></td>' : ''}
        <td>${a.erro ? '<span class="falta">✕ ' + esc(a.erro) + '</span>' : '✓'} ${esc(a.filename)}</td><td>${esc((a.created_at || '').slice(0, 10))}</td>
        <td>${a.signature_status ? esc(a.signature_status) : '—'}</td><td>${a.paginas ?? ''}</td></tr>`).join('')
    : `<tr><td><b>${it.doc_id}</b></td><td>${esc(it.nome)}</td><td colspan="4" class="falta">✕ não encontrado na Factorial</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:12px/1.45 Arial,sans-serif;margin:32px;color:#111} h1{font-size:18px;margin:0 0 4px} .sub{color:#555;margin-bottom:16px}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}
    th{color:#666;font-weight:600} .falta{color:#b00020} .nota{margin-top:16px;color:#555}
  </style></head><body>
    <h1>Pacote Bernhoeft · ${esc(func.full_name)}</h1>
    <div class="sub">CPF ${cpfOculto(func.identifier)} · ${func.active === false ? 'DESLIGADO' + (func.terminated_on ? ' em ' + esc(func.terminated_on) : '') : 'ativo'} · gerado em ${esc(gerado)} · fonte: Factorial · CONFERÊNCIA, não enviado</div>
    <table width="100%" cellpadding="4"><col width="40"><col width="190"><col width="250"><col width="80"><col width="80"><col width="36">
      <tr><th>doc</th><th>documento exigido</th><th>arquivo na Factorial</th><th>data</th><th>assinatura</th><th>pág.</th></tr>${linhas}</table>
    ${outros.length ? `<div class="nota"><b>Outros documentos do funcionário na Factorial (não usados):</b> ${outros.map((o) => esc(o.filename)).join(' · ')}</div>` : ''}
  </body></html>`;
}

// ---------- Montagem ----------
// Baixa cada arquivo (it = grupo com doc_id, a = documento da Factorial), converte para PDF e grava em destino/partes.
async function baixar(usar, destino, log) {
  const urls = usar.length
    ? Object.fromEntries((await api('/documents/download_urls/bulk_create', { method: 'POST', body: JSON.stringify({ ids: usar.map((u) => Number(u.a.id)) }) }))
      .map((x) => [String(x.id), x.url]))
    : {};
  const pdfs = [];
  for (const { it, a } of usar) {
    try {
      // Link temporário (S3): baixar SEM a chave da Factorial no cabeçalho.
      const r = await fetch(urls[a.id]);
      if (!r.ok) throw new Error(`download ${r.status}`);
      let buf = Buffer.from(await r.arrayBuffer());
      const ext = (a.extension || path.extname(a.filename).slice(1) || '').replace(/^\./, '').toLowerCase();
      if (!ehPdf(buf)) {
        if (ext === 'pdf') throw new Error('o arquivo diz ser PDF mas não é (corrompido?)');
        if (!CONVERTER.test(ext)) throw new Error(`formato .${ext} não convertido`);
        buf = await paraPdf(`arquivo.${ext}`, buf);
        if (!ehPdf(buf)) throw new Error('a conversão para PDF falhou');
      }
      a.paginas = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length || null;
      a.arquivo = `partes/${it.doc_id}-${a.id}-${slug(path.parse(a.filename).name)}.pdf`;
      fs.writeFileSync(path.join(destino, a.arquivo), buf);
      pdfs.push(buf);
      log(`  ✓ ${it.doc_id} ${a.filename}`);
    } catch (e) {
      a.erro = e.message;
      log(`  ✕ ${it.doc_id} ${a.filename}: ${e.message}`);
    }
  }
  return pdfs;
}

// Documento de EMPRESA (pasta HSEQ etc.): une os arquivos da Factorial com os IDs dados, nessa ordem, num PDF só.
// Sem capa: este PDF é o que vai para o portal. O resumo.json guarda a origem de cada parte.
async function montarEmpresa(titulo, ids, log = console.log) {
  ids = ids.map(String).filter((x) => /^\d+$/.test(x));
  if (!ids.length) throw new Error('Informe os IDs dos documentos da Factorial.');
  const pastas = Object.fromEntries((await todos('/documents/folders')).map((p) => [String(p.id), p.name]));
  const docs = [];
  for (const id of ids) {
    const d = await api(`/documents/documents/${id}`);
    docs.push(d.data || d);
  }
  const it = { doc_id: 'empresa', nome: titulo, arquivos: docs.map((d) => ({ id: String(d.id), filename: d.filename, pasta: pastas[String(d.folder_id)] || null, created_at: d.created_at, extension: d.extension, signature_status: d.signature_status || null })) };
  for (const a of it.arquivos) if (a.signature_status && a.signature_status !== 'completed') log(`  ! ${a.filename}: assinatura ${a.signature_status}`);

  const destino = path.join(PACOTES, `empresa-${slug(titulo)}`);
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(path.join(destino, 'partes'), { recursive: true });
  const pdfs = await baixar(it.arquivos.map((a) => ({ it, a })), destino, log);
  if (!pdfs.length) throw new Error('Nenhum arquivo baixado.');
  const final = pdfs.length > 1 ? await unir(pdfs) : pdfs[0];
  fs.writeFileSync(path.join(destino, 'pacote.pdf'), final);
  const resumo = { gerado_em: new Date().toISOString(), empresa: true, titulo, itens: [it], outros: [], achados: pdfs.length, exigidos: ids.length };
  fs.writeFileSync(path.join(destino, 'resumo.json'), JSON.stringify(resumo, null, 2));
  log(`Pacote: ${path.join(destino, 'pacote.pdf')} (${pdfs.length} de ${ids.length} arquivos, ${Math.round(final.length / 1024)} KB)`);
  return { pasta: path.basename(destino), ...resumo };
}

async function montar(busca, log = console.log) {
  const func = await acharFuncionario(busca);
  log(`Funcionário: ${func.full_name} (id ${func.id}, CPF ${cpfOculto(func.identifier)})`);
  const pastas = Object.fromEntries((await todos('/documents/folders')).map((p) => [String(p.id), p.name]));
  const docs = (await todos(`/documents/documents?employee_ids[]=${encodeURIComponent(func.id)}`)).filter((d) => !d.deleted_at);
  log(`${docs.length} documento(s) do funcionário na Factorial`);

  const itens = REGRAS.map((r) => ({ doc_id: r.doc_id, nome: r.nome, arquivos: [] }));
  const outros = [];
  for (const d of docs) {
    const texto = normalizar(`${d.filename} ${pastas[String(d.folder_id)] || ''}`);
    const k = REGRAS.findIndex((r) => r.achar.test(texto));
    const info = { id: String(d.id), filename: d.filename, pasta: pastas[String(d.folder_id)] || null, created_at: d.created_at, extension: d.extension, signature_status: d.signature_status || null };
    if (k >= 0) itens[k].arquivos.push(info); else outros.push(info);
  }
  for (const it of itens) it.arquivos.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const destino = path.join(PACOTES, `${func.id}-${slug(func.full_name)}`);
  const partes = path.join(destino, 'partes');
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(partes, { recursive: true });

  const pdfs = await baixar(itens.flatMap((it) => it.arquivos.map((a) => ({ it, a }))), destino, log);

  const gerado = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const capaPdf = await htmlParaPdf(capa(func, itens, outros, gerado));
  fs.writeFileSync(path.join(destino, 'pacote.pdf'), pdfs.length ? await unir([capaPdf, ...pdfs]) : capaPdf);
  const resumo = {
    gerado_em: new Date().toISOString(),
    funcionario: { id: String(func.id), nome: func.full_name, cpf: cpfOculto(func.identifier), ativo: func.active !== false },
    itens, outros,
    achados: itens.filter((it) => it.arquivos.some((a) => a.arquivo)).length,
    exigidos: itens.length,
  };
  fs.writeFileSync(path.join(destino, 'resumo.json'), JSON.stringify(resumo, null, 2));
  log(`Pacote: ${path.join(destino, 'pacote.pdf')} (${resumo.achados} de ${resumo.exigidos} documentos achados)`);
  return { pasta: path.basename(destino), ...resumo };
}

module.exports = { montar, montarEmpresa, REGRAS, PACOTES, temChave: () => Boolean(CHAVE), api, todos, baixar, unir, normalizar, slug };

if (require.main === module) {
  const k = process.argv.indexOf('--empresa');
  if (k >= 0) {
    // node pacote.js --empresa "Título" 111 222 333
    const [titulo, ...ids] = process.argv.slice(k + 1);
    montarEmpresa(titulo || 'documento', ids).catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
    return;
  }
  const busca = process.argv.slice(2).join(' ').trim();
  if (!busca) { console.log('Uso: node pacote.js "Nome do Funcionário" | CPF'); process.exit(1); }
  montar(busca).catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
}
