// Mobilização no Bernhoeft (ContractWeb): faz o que o Pablo mostrou na reunião de 22/10 (docs/bernhoeft-mobilizacao-video-2026-10-22.md).
//
//   1. Factorial: acha cada colaborador pelo CPF, lê os dados do cadastro e escolhe os arquivos de cada item.
//   2. Bernhoeft → Carregamento de Documentos → Mobilização: filtra o contrato e cria a Nova Mobilização (contrato + contratada).
//      Se o portal avisar "objetos bloqueáveis com pendências" (documento de empresa pendente), para e diz quais.
//   3. Etapa 2: cadastra o colaborador com os dados da Factorial. Se o CPF já estiver cadastrado, usa o que existe.
//   4. Etapas 3 e 4: só avança.
//   5. Etapa 5: em cada item pedido, sobe o arquivo (nuvem) ou põe o comentário padrão (balão, comentarios.json).
//   6. Etapa 8: conclui o carregamento, só com --concluir.
//
// NUNCA TESTADO (escrito em 22/10, teste com o time do Bernhoeft em chamada no dia 23/10). Os seletores saíram do vídeo e das
// rotas vistas no portal (AtualizarColaborador/EtapaN/<id>): conferir cada um na chamada com --descobrir.
//
// Uso:
//   node mobilizacao.js plano.json                 ensaio: abre, lê, monta o plano e tira print; não preenche nem salva nada
//   node mobilizacao.js plano.json --descobrir     ensaio + grava o HTML e as chamadas XHR de cada tela (para ajustar seletores)
//   node mobilizacao.js plano.json --executar      faz de verdade (cria mobilização, cadastra, sobe, comenta)
//   node mobilizacao.js plano.json --executar --passo   pergunta no terminal antes de CADA clique que grava
//   ... --concluir                                 também clica em Concluir na etapa 8
//
// plano.json (fora do repo, tem CPF):
//   { "contrato": "757/2025-PA", "contratada": "NIP GLOBAL",
//     "mobilizacao_id": null,                      // opcional: continuar uma mobilização já criada (id da URL EtapaN/<id>)
//     "colaboradores": [ { "cpf": "...", "administrativo": true, "conduz_veiculo": false, "faz_nr": false } ] }
//   administrativo / conduz_veiculo / faz_nr decidem os comentários "NÃO APLICÁVEL" (ainda não há de onde tirar isso sozinho).
//
// Variáveis: FACTORIAL_API_KEY, FACTORIAL_API_URL, PROFILE_DIR, CHROME_PATH, HEADLESS=1.
// Sessão: usa o profile/ do pendencias.js. Se a sessão caiu, sai com código 2 (rodar o pendencias.js, que refaz o login).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { chromium } = require('playwright');

const BASE = 'https://newcontract.contractweb.com.br';
const PROFILE = process.env.PROFILE_DIR || path.join(__dirname, 'profile');
const OUT = path.join(__dirname, 'out', 'mobilizacao');
const API = (process.env.FACTORIAL_API_URL || 'https://api.factorialhr.com/api/2026-07-01/resources').replace(/\/$/, '');
const CHAVE = (process.env.FACTORIAL_API_KEY || '').trim();
const COMENT = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, 'comentarios.json'), 'utf8')).comentarios.map((c) => [c.id, c.texto]));

const args = process.argv.slice(2);
const ARQ_PLANO = args.find((a) => !a.startsWith('--'));
const EXECUTAR = args.includes('--executar');
const PASSO = args.includes('--passo');
const DESCOBRIR = args.includes('--descobrir');
const CONCLUIR = args.includes('--concluir');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const dig = (s) => String(s || '').replace(/\D/g, '');
const mascara = (cpf) => { const d = dig(cpf); return d.length === 11 ? `***.${d.slice(3, 6)}.***-${d.slice(9)}` : '?'; };
const agora = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const RODADA = path.join(OUT, agora());
const relatorio = { em: new Date().toISOString(), modo: EXECUTAR ? 'executar' : 'ensaio', contrato: null, mobilizacao_id: null, parou: null, colaboradores: [] };
const log = (...m) => console.log(new Date().toLocaleTimeString('pt-BR'), ...m);

// ---------------------------------------------------------------- Factorial (só leitura)
async function api(caminho, opts = {}) {
  let r;
  for (let t = 0; t < 4; t++) {
    r = await fetch(`${API}${caminho}`, { ...opts, headers: { 'x-api-key': CHAVE, accept: 'application/json', ...(opts.body ? { 'content-type': 'application/json' } : {}) } });
    if (r.status !== 429) break;
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  if (!r.ok) throw new Error(`Factorial respondeu ${r.status} em ${caminho.split('?')[0]}`);
  return r.json();
}
async function todos(caminho) {
  const itens = []; let cursor = null;
  for (let i = 0; i < 200; i++) {
    const j = await api(`${caminho}${caminho.includes('?') ? '&' : '?'}limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`);
    itens.push(...(j.data || []));
    if (!j.meta?.has_next_page) break;
    cursor = j.meta.end_cursor;
  }
  return itens;
}

// Cada item da etapa 5 (pelo nome que o portal mostra): de que pasta/nome vem o arquivo na Factorial
// e qual comentário vai quando não há arquivo. A ordem importa: o primeiro que casar vale.
const ITENS = [
  { chave: 'aso', item: /\baso\b|atestado de saude/, arquivo: (n, p) => /\baso\b/.test(n) && !/demissional/.test(n) },
  { chave: 'socorros', item: /primeiros socorros/, arquivo: (n) => /primeiros socorros/.test(n),
    comentario: (c, feitos) => feitos.has('direcao') ? 'socorros_dd' : c.administrativo ? 'socorros_adm' : null },
  { chave: 'direcao', item: /direcao defensiva/, arquivo: (n) => /direcao defensiva/.test(n), comentario: (c) => c.conduz_veiculo === false ? 'nao_conduz' : null },
  { chave: 'cnh', item: /\bcnh\b|habilitacao/, arquivo: (n) => /\bcnh\b|habilitacao/.test(n), comentario: (c) => c.conduz_veiculo === false ? 'nao_conduz' : null },
  { chave: 'qualificacao', item: /qualificacao profissional|certificado de qualificacao/, arquivo: (n) => /qualificacao/.test(n) },
  { chave: 'integracao', item: /integracao/, arquivo: (n) => /integracao/.test(n) },
  { chave: 'epi', item: /\bepi\b/, arquivo: (n) => /\bepi\b/.test(n), comentario: (c) => c.administrativo ? 'epi_adm' : null },
  // CTPS e ficha de registro: vai o eSocial, com o comentário de substituição (como o Pablo fez no vídeo).
  { chave: 'ctps', item: /ctps|carteira de trabalho/, arquivo: (n) => /\bctps\b|carteira de trabalho/.test(n), substituto: { arquivo: (n) => /\besocial\b|\be social\b/.test(n), comentario: 'ctps_esocial' } },
  { chave: 'ficha', item: /ficha de registro/, arquivo: (n) => /ficha de registro/.test(n), substituto: { arquivo: (n) => /\besocial\b|\be social\b/.test(n), comentario: 'ficha_esocial' } },
  { chave: 'rgcpf', item: /\brg\b|\bcpf\b|identidade/, arquivo: (n) => /\brg\b|identidade/.test(n), substituto: { arquivo: (n) => /\bcnh\b|habilitacao/.test(n), comentario: 'rg_cnh' } },
  { chave: 'nr', item: /\bnr\s?\d|\bnrs?\b|ordem de servico|treinamentos? de seguranca/, arquivo: (n) => /\bnr\s?\d|ordem de servico|\bos\b/.test(n), comentario: (c) => c.faz_nr === false ? 'sem_nr' : null },
];

async function lerFactorial(plano) {
  if (!CHAVE) throw new Error('FACTORIAL_API_KEY não configurada.');
  const pastas = Object.fromEntries((await todos('/documents/folders')).map((f) => [String(f.id), f.name]));
  const funcionarios = await todos('/employees/employees');
  for (const c of plano.colaboradores) {
    const r = { cpf: mascara(c.cpf), ok: false, dados: null, arquivos: [], itens: [] };
    relatorio.colaboradores.push(r);
    const f = funcionarios.filter((e) => dig(e.identifier) === dig(c.cpf));
    if (f.length !== 1) { r.motivo = f.length ? `${f.length} funcionários com esse CPF na Factorial` : 'CPF não achado na Factorial'; continue; }
    const e = f[0];
    // Contrato atual: função, salário e admissão (campos a conferir na chamada; o que vier vazio fica para a pessoa preencher).
    const versoes = await todos(`/contracts/contract-versions?employee_ids[]=${e.id}`).catch(() => []);
    const v = versoes.sort((a, b) => String(b.effective_on).localeCompare(String(a.effective_on)))[0] || {};
    r.dados = {
      nome: e.full_name || [e.first_name, e.last_name].filter(Boolean).join(' '),
      matricula: e.company_identifier || '',
      pis: e.social_security_number || '',
      cpf: dig(e.identifier),
      rg: '', // a Factorial não traz RG no cadastro (ver 22/10); fica vazio
      nascimento: e.birthday_on || '',
      sexo: e.gender === 'female' ? 'Feminino' : e.gender === 'male' ? 'Masculino' : '',
      funcao: v.job_title || '',
      salario: v.salary_amount != null ? (Number(v.salary_amount) / 100).toFixed(2).replace('.', ',') : '',
      admissao: v.starts_on || e.start_date || '',
    };
    r.faltam = Object.entries(r.dados).filter(([, x]) => !x).map(([k]) => k);
    const docs = (await todos(`/documents/documents?employee_ids[]=${e.id}`)).filter((d) => !d.deleted_at && /^\.?pdf$/i.test(String(d.extension || path.extname(d.filename))))
      .map((d) => ({ id: d.id, nome: norm(d.filename), arquivo: d.filename, pasta: pastas[String(d.folder_id)] || '', criado: d.created_at }));
    r._docs = docs; r._plano = c; r.ok = true;
    log(`Factorial ${r.cpf}: ${docs.length} PDF(s)${r.faltam.length ? `; sem ${r.faltam.join(', ')}` : ''}`);
  }
}

// Escolhe o que fazer num item da etapa 5. Arquivo só quando há EXATAMENTE 1 candidato (igual ao factorial.js do Atlas).
function decidir(col, textoItem, feitos) {
  const t = norm(textoItem);
  const regra = ITENS.find((x) => x.item.test(t));
  if (!regra) return { acao: 'nada', motivo: 'item sem regra' };
  const um = (fn) => col._docs.filter((d) => fn(d.nome, norm(d.pasta)));
  const cand = um(regra.arquivo);
  if (cand.length === 1) return { regra: regra.chave, acao: 'arquivo', doc: cand[0] };
  if (cand.length > 1) return { regra: regra.chave, acao: 'nada', motivo: `${cand.length} arquivos possíveis na Factorial (${cand.map((d) => d.id).join(', ')}): alguém escolhe` };
  if (regra.substituto) {
    const s = um(regra.substituto.arquivo);
    if (s.length === 1) return { regra: regra.chave, acao: 'arquivo', doc: s[0], comentario: COMENT[regra.substituto.comentario] };
    if (s.length > 1) return { regra: regra.chave, acao: 'nada', motivo: `${s.length} substitutos possíveis: alguém escolhe` };
  }
  const id = regra.comentario?.(col._plano, feitos);
  if (id) return { regra: regra.chave, acao: 'comentario', comentario: COMENT[id] };
  return { regra: regra.chave, acao: 'nada', motivo: 'sem arquivo na Factorial e sem comentário que se aplique' };
}

async function baixar(doc) {
  const pasta = path.join(OUT, 'arquivos');
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const arq = path.join(pasta, `${doc.id}.pdf`);
  if (fs.existsSync(arq)) return arq;
  const link = await api('/documents/download_urls/bulk_create', { method: 'POST', body: JSON.stringify({ ids: [Number(doc.id)] }) }).then((x) => (x.data || x)[0]);
  const res = await fetch(link.url);
  if (!res.ok) throw new Error(`download ${doc.id} falhou (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`arquivo ${doc.id} não é PDF`);
  fs.writeFileSync(arq, buf, { mode: 0o600 });
  doc.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return arq;
}

// ---------------------------------------------------------------- navegador
let page;
let nTela = 0;
const xhr = [];
async function registrar(nome) {
  nTela++;
  const base = path.join(RODADA, `${String(nTela).padStart(2, '0')}-${nome}`);
  await page.screenshot({ path: base + '.png', fullPage: true }).catch(() => {});
  if (DESCOBRIR) {
    fs.writeFileSync(base + '.html', await page.content());
    fs.writeFileSync(base + '.xhr.txt', xhr.splice(0).join('\n'));
  }
}
async function perguntar(texto) {
  if (!PASSO) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const r = await new Promise((ok) => rl.question(`\n>>> ${texto}\n    Enter = fazer, n = pular, q = parar: `, ok));
  rl.close();
  if (/^q/i.test(r)) throw Object.assign(new Error('parado pelo operador'), { parar: true });
  return !/^n/i.test(r);
}
// Clique que GRAVA no portal: só com --executar (e com --passo, depois do Enter).
async function gravar(descricao, fn) {
  if (!EXECUTAR) { log(`[ensaio] faria: ${descricao}`); return false; }
  if (!(await perguntar(descricao))) { log(`pulado: ${descricao}`); return false; }
  log(`fazendo: ${descricao}`);
  await fn();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  return true;
}
const botao = (re) => page.locator('button, a, input[type=button], input[type=submit]').filter({ hasText: re }).first();
async function avisoDoPortal() { // modal "Aviso!" / SweetAlert / toast: devolve o texto, se houver
  const m = page.locator('.swal2-popup:visible, .modal.show:visible, .toast:visible, .alert-danger:visible').first();
  return (await m.count()) ? norm(await m.innerText().catch(() => '')) : '';
}
async function proximo(etapa) {
  await registrar(`etapa${etapa}`);
  const b = botao(/pr[oó]ximo/i);
  if (!(await b.count())) throw new Error(`etapa ${etapa}: botão "Próximo" não achado`);
  // Avançar de etapa não grava nada sozinho (no vídeo os dados já tinham sido salvos antes); fica livre no ensaio
  // só quando a mobilização já existe.
  await b.click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
}

async function abrirSessao() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.HEADLESS === '1',
    executablePath: process.env.CHROME_PATH || undefined,
    locale: 'en-US', viewport: { width: 1440, height: 900 },
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
  });
  page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);
  page.on('request', (r) => { if (['xhr', 'fetch'].includes(r.resourceType())) xhr.push(`${r.method()} ${r.url().replace(BASE, '').slice(0, 200)}${r.method() === 'POST' ? ' ' + String(r.postData() || '').slice(0, 300).replace(/\d{11}/g, '<cpf>') : ''}`); });
  await page.goto(BASE + '/Home', { waitUntil: 'domcontentloaded' });
  if (await page.$('#password')) { await ctx.close(); log('Sessão do Bernhoeft caiu: rode o pendencias.js (refaz o login) e tente de novo.'); process.exit(2); }
  return ctx;
}

// Passo 2: abre (ou cria) a mobilização do contrato. Devolve o id da URL (EtapaN/<id>).
async function abrirMobilizacao(plano) {
  if (plano.mobilizacao_id) {
    await page.goto(`${BASE}/AtualizarColaborador/Etapa2/${plano.mobilizacao_id}`, { waitUntil: 'domcontentloaded' });
    return String(plano.mobilizacao_id);
  }
  // Menu: Carregamento de Documentos → Mobilização (a rota direta ainda não é conhecida; --descobrir grava a URL).
  await page.getByText(/carregamento de documentos/i).first().click();
  await page.getByText(/^\s*mobiliza[cç][aã]o\s*$/i).first().click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  log(`Tela de mobilização: ${page.url().replace(BASE, '')}`);
  await registrar('lista-mobilizacao');

  await botao(/nova mobiliza/i).click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  // "Inclusão de Mobilização": selects Contrato* e Contratada* (no vídeo, select2/select comum; tenta os dois).
  await escolher(/contrato/i, plano.contrato);
  await escolher(/contratada/i, plano.contratada);
  await registrar('inclusao-mobilizacao');
  const criou = await gravar(`criar mobilização no contrato ${plano.contrato}`, async () => { await botao(/salvar/i).click(); });
  const aviso = await avisoDoPortal();
  if (/bloqueave|pendencia/.test(aviso)) {
    relatorio.parou = `contrato com documento de empresa pendente: ${aviso.slice(0, 400)}`;
    throw Object.assign(new Error(relatorio.parou), { parar: true });
  }
  if (!criou) return null;
  const id = (page.url().match(/Etapa\d\/(\d+)/) || [])[1];
  if (!id) throw new Error(`mobilização salva, mas a URL não trouxe o id (${page.url().replace(BASE, '')})`);
  return id;
}
async function escolher(rotulo, valor) {
  const campo = page.getByLabel(rotulo).first();
  if (await campo.count()) {
    const tag = await campo.evaluate((el) => el.tagName).catch(() => '');
    if (tag === 'SELECT') {
      const op = await campo.locator('option').evaluateAll((os, v) => (os.find((o) => o.textContent.toLowerCase().includes(v.toLowerCase())) || {}).value, valor);
      if (op == null) throw new Error(`opção "${valor}" não existe em ${rotulo}`);
      return campo.selectOption(op);
    }
  }
  // select2: clica no rótulo do campo, digita e escolhe a 1ª opção que contém o texto
  const grupo = page.locator('.form-group, div').filter({ hasText: rotulo }).locator('.select2-selection, .select2').first();
  await grupo.click();
  await page.keyboard.type(valor, { delay: 30 });
  await page.locator('.select2-results__option').filter({ hasText: valor }).first().click();
}

// Passo 3: etapa 2, cadastra cada colaborador. Colunas da grade no vídeo:
// Nome Completo | Matrícula | PIS | CPF | RG | Passaporte | Data Nascimento | Sexo | Salário | ... | Função | Admissão.
const COLUNAS = { nome: /nome completo/, matricula: /matricula/, pis: /\bpis\b/, cpf: /\bcpf\b/, rg: /\brg\b/, nascimento: /nascimento/, sexo: /sexo/, salario: /salario/, funcao: /funcao|cargo/, admissao: /admissao/ };
async function etapa2(id, plano) {
  if (id) await page.goto(`${BASE}/AtualizarColaborador/Etapa2/${id}`, { waitUntil: 'domcontentloaded' });
  await registrar('etapa2-antes');
  for (const col of relatorio.colaboradores.filter((c) => c.ok)) {
    await gravar(`cadastrar ${col.cpf} na etapa 2`, async () => {
      await page.locator('button:has(.fa-plus), button[title*="dicionar"], .btn-add, button').filter({ hasText: /^\s*\+?\s*$/ }).first().click();
      const linha = page.locator('table tbody tr').last();
      const cab = (await page.locator('table thead th').allInnerTexts()).map(norm);
      for (const [campo, re] of Object.entries(COLUNAS)) {
        const i = cab.findIndex((h) => re.test(h));
        if (i < 0 || !col.dados[campo]) continue;
        const cel = linha.locator('td').nth(i).locator('input, select').first();
        if ((await cel.evaluate((el) => el.tagName)) === 'SELECT') await cel.selectOption({ label: col.dados[campo] }).catch(() => {});
        else if ((await cel.getAttribute('type')) === 'date') await cel.fill(col.dados[campo].slice(0, 10));
        else await cel.fill(String(col.dados[campo]));
        if (campo === 'cpf') {
          await cel.press('Tab');
          await page.waitForTimeout(1500);
          // No vídeo: ao digitar o CPF o portal mostra "Histórico das competências do colaborador" se ele já existe.
          const ja = page.locator('.modal:visible, .swal2-popup:visible').filter({ hasText: /hist[oó]rico|j[aá] est[aá]/i });
          if (await ja.count()) { col.ja_cadastrado = true; await ja.locator('button').filter({ hasText: /ok|fechar/i }).first().click().catch(() => {}); }
        }
      }
      await botao(/^\s*salvar\s*$/i).click();
    });
    const aviso = await avisoDoPortal();
    if (aviso) col.aviso_etapa2 = aviso.slice(0, 300);
  }
  await registrar('etapa2-depois');
}

// Passo 5: etapa 5, um bloco por colaborador (cabeçalho roxo com o nome), uma linha por item pedido.
async function etapa5(id) {
  if (id) await page.goto(`${BASE}/AtualizarColaborador/Etapa5/${id}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await registrar('etapa5-antes');
  for (const col of relatorio.colaboradores.filter((c) => c.ok)) {
    const bloco = page.locator('.card, .panel, .accordion-item, div').filter({ hasText: new RegExp(col.dados.nome.split(' ')[0], 'i') })
      .filter({ has: page.locator('text=/Documento/') }).first();
    if (!(await bloco.count())) { col.motivo = 'colaborador não aparece na etapa 5'; continue; }
    await bloco.locator('text=/' + col.dados.nome.split(' ')[0] + '/i').first().click().catch(() => {}); // abre o acordeão
    const linhas = bloco.locator('tr, .row').filter({ has: page.locator('button') });
    const n = await linhas.count();
    const feitos = new Set();
    for (let i = 0; i < n; i++) {
      const l = linhas.nth(i);
      const texto = (await l.innerText().catch(() => '')).split('\n')[0];
      if (!texto.trim() || /^documento$/i.test(texto.trim())) continue;
      const jaTem = /\.pdf/i.test(await l.innerText());
      const d = jaTem ? { acao: 'nada', motivo: 'já tem arquivo anexado' } : decidir(col, texto, feitos);
      const it = { item: texto.slice(0, 120), ...d, doc: d.doc ? { id: d.doc.id, pasta: d.doc.pasta } : undefined };
      col.itens.push(it);
      if (d.acao === 'arquivo') {
        const arq = await baixar(d.doc);
        it.sha256 = d.doc.sha256;
        const ok = await gravar(`subir ${path.basename(arq)} em "${texto.slice(0, 60)}" (${col.cpf})`, async () => {
          // nuvem = 1º botão da linha; abre um modal com input file
          await l.locator('button').nth(0).click();
          const modal = page.locator('.modal:visible').last();
          await modal.locator('input[type=file]').setInputFiles(arq);
          await modal.locator('button').filter({ hasText: /salvar|enviar|anexar|confirmar/i }).first().click();
        });
        if (ok) feitos.add(d.regra);
      }
      if (d.comentario) {
        const ok = await gravar(`comentário em "${texto.slice(0, 60)}" (${col.cpf}): ${d.comentario}`, async () => {
          // balão = 3º botão da linha (nuvem, lápis, balão)
          await l.locator('button').nth(2).click();
          const modal = page.locator('.modal:visible').last();
          await modal.locator('textarea').first().fill(d.comentario);
          await modal.locator('button').filter({ hasText: /salvar|enviar|confirmar/i }).first().click();
        });
        if (ok) feitos.add(d.regra + ':comentario');
      }
      const aviso = await avisoDoPortal();
      if (aviso) it.aviso = aviso.slice(0, 300);
    }
  }
  await registrar('etapa5-depois');
}

// ---------------------------------------------------------------- principal
(async () => {
  if (!ARQ_PLANO) { console.log('Uso: node mobilizacao.js plano.json [--descobrir] [--executar] [--passo] [--concluir]'); process.exit(1); }
  const plano = JSON.parse(fs.readFileSync(ARQ_PLANO, 'utf8'));
  relatorio.contrato = plano.contrato;
  fs.mkdirSync(RODADA, { recursive: true, mode: 0o700 });
  log(`Mobilização ${plano.contrato}: ${plano.colaboradores.length} colaborador(es), modo ${EXECUTAR ? 'EXECUTAR' + (PASSO ? ' passo a passo' : '') : 'ensaio (nada é gravado)'}`);
  await lerFactorial(plano);
  const ctx = await abrirSessao();
  try {
    const id = await abrirMobilizacao(plano);
    relatorio.mobilizacao_id = id;
    if (!id && !EXECUTAR) {
      // Ensaio sem mobilização existente: não dá para ver as etapas; mostra só o que faria com os arquivos.
      for (const col of relatorio.colaboradores.filter((c) => c.ok))
        for (const r of ITENS) { const d = decidir(col, r.chave === 'aso' ? 'aso' : r.item.source.replace(/\\b|[|()?\\]/g, ' '), new Set()); col.itens.push({ item: r.chave, ...d, doc: d.doc ? { id: d.doc.id, pasta: d.doc.pasta } : undefined }); }
      log('Ensaio: sem mobilization_id no plano, as etapas não foram abertas. Para ver as etapas, ponha o id de uma mobilização existente.');
    } else {
      await etapa2(id, plano);
      await proximo(2); // → 3
      await proximo(3); // → 4
      await proximo(4); // → 5
      await etapa5(id);
      if (CONCLUIR) {
        await page.goto(`${BASE}/AtualizarColaborador/Etapa8/${id}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await registrar('etapa8');
        await gravar('CONCLUIR o carregamento (etapa 8)', async () => { await botao(/concluir/i).click(); });
      }
    }
  } catch (e) {
    relatorio.parou = relatorio.parou || e.message.split('\n')[0];
    log('PAROU:', relatorio.parou);
    await registrar('erro').catch(() => {});
    if (!e.parar) process.exitCode = 1;
  } finally {
    for (const c of relatorio.colaboradores) { delete c._docs; delete c._plano; if (c.dados) c.dados = { ...c.dados, cpf: c.cpf, pis: c.dados.pis ? '<tem>' : '', nome: c.dados.nome ? '<tem>' : '' }; }
    fs.writeFileSync(path.join(RODADA, 'relatorio.json'), JSON.stringify(relatorio, null, 2));
    for (const c of relatorio.colaboradores) {
      log(`${c.cpf}: ${c.ok ? '' : c.motivo}`);
      for (const it of c.itens) log(`   ${it.acao.padEnd(10)} ${it.item}${it.doc ? ` ← Factorial ${it.doc.id} (${it.doc.pasta})` : ''}${it.comentario ? ` + "${it.comentario}"` : ''}${it.motivo ? ` · ${it.motivo}` : ''}`);
    }
    log(`Relatório e prints em ${RODADA}`);
    await ctx.close();
  }
})().catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; });
