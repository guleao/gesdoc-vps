// Esteira automática Bernhoeft, sem ninguém escolher nada:
//   1. pega as pendências "Não Entregue" que o robô Bernhoeft gravou (pendencias.json);
//   2. para cada uma, acha na Factorial (pastas HSEQ) os arquivos do tipo pedido e escolhe os do contrato/estado certo;
//   3. baixa, converte e une num PDF só (pacote.js) e deixa pronto para subir.
// SOMENTE LEITURA na Factorial e nada é enviado ao Bernhoeft. Saída em PACOTES/auto/<pasta>/ e PACOTES/auto/estado.json.
// Teste da escolha sem rede: node auto.js --testar cruzamento.json pendencias.json
const fs = require('fs');
const path = require('path');
const p = require('./pacote');
const lerPdf = require('./ler-pdf');

const DIR = path.join(p.PACOTES, 'auto');
const ARQ_ESTADO = path.join(DIR, 'estado.json');
const MAX_ARQUIVOS = 10;

// Tipo de documento: "pend" reconhece a descrição da pendência; "arq" são as palavras que o nome do arquivo precisa ter
// (basta um grupo casar inteiro). Mesma tabela do cruzamento Bernhoeft x Factorial de 14/10.
const TIPOS = [
  { nome: 'Brigada de Incêndio', pend: /brigada/, arq: [['brigada']] },
  { nome: 'Plano de Emergência Contra Incêndio', pend: /emergencia contra incendio/, arq: [['emergencia', 'contra', 'incendio'], ['pec']] },
  { nome: 'Plano de Atendimento a Emergência (PAE)', pend: /atendimento a emergencia|\bpae\b/, arq: [['pae'], ['atendimento', 'emergencia']] },
  { nome: 'Projeto de Prevenção e Combate a Incêndio e AVCB', pend: /avcb|combate a incendio|combate incendio/, arq: [['avcb'], ['ppci'], ['combate', 'incendio']] },
  { nome: 'Análise Ergonômica do Trabalho (AET)', pend: /ergonom|\baet\b/, arq: [['aet'], ['ergonom']] },
  { nome: 'Laudo de Insalubridade / Periculosidade', pend: /insalubr|periculos/, arq: [['insalubr'], ['periculos'], ['ltcat']] },
  { nome: 'PCMSO', pend: /pcmso/, arq: [['pcmso']] },
  { nome: 'CIPA', pend: /cipa/, arq: [['cipa']] },
  { nome: 'Laudo de Isolação Elétrica de EPI e EPC', pend: /isolacao/, arq: [['isola'], ['dieletric'], ['ensaio']] },
  { nome: 'Procedimento Operacional Padrão', pend: /procedimento operacional/, arq: [['pop'], ['procedimento', 'operacional']] },
  { nome: 'Relação de ferramentas, máquinas, EPI e EPC', pend: /ferramentas/, arq: [['ferramenta'], ['relacao', 'epi']] },
  { nome: 'Relação de Alojamentos', pend: /alojamento/, arq: [['alojamento']] },
];
// Conteúdo do PDF (29/10, ler-pdf.js): palavras que o documento certo tem no texto. Casar sobe a confiança;
// ter texto e não casar baixa. negativos = sinais de outro documento (baixa a confiança e vai para conferência).
const CONTEUDO = {
  'Brigada de Incêndio': [['brigada']],
  'Plano de Emergência Contra Incêndio': [['plano', 'emergencia'], ['emergencia', 'incendio']],
  'Plano de Atendimento a Emergência (PAE)': [['atendimento', 'emergencia'], ['pae']],
  'Projeto de Prevenção e Combate a Incêndio e AVCB': [['avcb'], ['auto de vistoria'], ['ppci'], ['prevencao', 'combate', 'incendio'], ['projeto', 'incendio']],
  'Análise Ergonômica do Trabalho (AET)': [['ergonom*'], ['aet']],
  'Laudo de Insalubridade / Periculosidade': [['insalubr*'], ['periculos*'], ['ltcat']],
  PCMSO: [['pcmso'], ['controle medico', 'saude ocupacional']],
  CIPA: [['cipa'], ['comissao interna', 'prevencao']],
  'Laudo de Isolação Elétrica de EPI e EPC': [['isolacao'], ['dieletric*'], ['ensaio']],
  'Procedimento Operacional Padrão': [['procedimento operacional'], ['pop']],
  'Relação de ferramentas, máquinas, EPI e EPC': [['ferramenta*'], ['epi']],
  'Relação de Alojamentos': [['alojamento*']],
};
const NEGATIVOS = [['nao aplicabilidade'], ['nao se aplica']];
// Contratos da Equatorial no Bernhoeft (CLAUDE.md, 22/10). Arquivo que cita QUALQUER outro deles (no nome ou no texto) e não
// cita o da pendência é bloqueado, mesmo que esse outro contrato não esteja pendente agora (caso da Brigada 356/2026, ficha 16).
const CONTRATOS = ['00223/2025-PA', '356/2026-MA', '406/2026-PI', '4600029823/2024-MA', '4600029828/2024-RS', '5000000897/2025-GO', '757/2025-MA', '815/2025-RS'];

const UFS = new Set('ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' '));
const ASSINATURA_OK = new Set([null, undefined, '', 'completed', 'signed', 'not_required']);
const CONFIANCA = { 3: 'alta', 2: 'média', 1: 'baixa' };

const n = (s) => p.normalizar(s);
const semZeros = (x) => String(x).replace(/^0+/, '');
const casa = (nome, grupos) => grupos.some((g) => g.every((w) => new RegExp(`(^|[^a-z])${w}`).test(n(nome))));

// "356/2026 - MA" -> { num: '356', uf: 'ma' }
function lerContrato(contrato) {
  const num = semZeros((String(contrato).match(/\d+/) || [''])[0]);
  const uf = (String(contrato).match(/-\s*([A-Za-z]{2})\s*$/) || [])[1];
  return { num, uf: uf ? uf.toLowerCase() : null };
}

// Quanto um arquivo serve para a pendência: 3 = cita o contrato, 2 = é do estado, 1 = genérico; null = é de outro contrato/estado.
function avaliar(filename, ct, outrosNums) {
  const t = n(filename);
  const nums = new Set((t.match(/\d+/g) || []).map(semZeros));
  const refs = [...t.matchAll(/(?:^|[^a-z])(?:ct|crt|contrato)\s*(\d+)/g)].map((m) => semZeros(m[1]));
  const ufs = t.split(/[^a-z0-9]+/).filter((w) => UFS.has(w));
  if (ct.num && (refs.includes(ct.num) || (ct.num.length >= 5 && nums.has(ct.num)))) return { nivel: 3, motivo: `cita o contrato ${ct.num}` };
  if (refs.length) return null;
  if ([...nums].some((x) => x.length >= 5 && outrosNums.has(x))) return null;
  // Número curto de outro contrato com o ano ("356-2026", "757_2025") também é contrato divergente.
  if ([...t.matchAll(/(\d+)\s*[/_-]\s*20\d\d/g)].some((m) => outrosNums.has(semZeros(m[1])))) return null;
  if (ufs.length && ct.uf && !ufs.includes(ct.uf)) return null;
  if (ct.uf && ufs.includes(ct.uf)) return { nivel: 2, motivo: `é do estado ${ct.uf.toUpperCase()}` };
  if (ufs.length) return null;
  return { nivel: 1, motivo: 'genérico (o nome não cita contrato nem estado): conferir' };
}

// Escolhe os arquivos de UMA pendência. docs = [{id, filename, created_at, signature_status, extension, pasta}].
function escolher(pend, docs, todasPendencias) {
  const tipo = TIPOS.find((x) => x.pend.test(n(pend.descricao)));
  if (!tipo) return { tipo: null, usar: [], deixados: [], motivo: 'tipo de documento sem regra de busca' };
  const ct = lerContrato(pend.contrato);
  const outrosNums = new Set([...CONTRATOS, ...todasPendencias.map((x) => x.contrato)].map((x) => lerContrato(x).num).filter((x) => x && x !== ct.num));
  const deixados = [];
  const aptos = [];
  for (const d of docs) {
    if (!casa(d.filename, tipo.arq)) continue;
    const a = avaliar(d.filename, ct, outrosNums);
    if (!a) continue;
    if (!ASSINATURA_OK.has(d.signature_status)) { deixados.push({ filename: d.filename, motivo: `assinatura ${d.signature_status}` }); continue; }
    aptos.push({ ...d, ...a });
  }
  if (!aptos.length) return { tipo: tipo.nome, usar: [], deixados, motivo: 'nenhum arquivo deste tipo para este contrato/estado' };
  const melhor = Math.max(...aptos.map((a) => a.nivel));
  const porData = (a, b) => String(a.created_at).localeCompare(String(b.created_at));
  // Contrato ou estado: une todos os arquivos desse nível (ex.: relação + memorial + calendário). Genérico: só o mais novo.
  let usar = aptos.filter((a) => a.nivel === melhor).sort(porData);
  if (melhor === 1) usar = usar.slice(-1);
  usar = usar.slice(-MAX_ARQUIVOS);
  return { tipo: tipo.nome, usar, deixados, nivel: melhor, confianca: CONFIANCA[melhor], motivo: usar[0].motivo };
}

// Lê o texto de cada parte baixada e decide (29/10). Parte que cita outro contrato da Equatorial e não o da pendência sai
// do pacote (contrato divergente bloqueia). Depois ajusta a confiança pelo que sobrou:
//   cita o contrato da pendência no texto = alta; tem palavra do tipo = sobe um nível; tem texto sem palavra do tipo ou com
//   sinal de outro documento ("não aplicabilidade") = baixa. Parte sem texto (imagem) não muda nada.
// partes = [{ a (arquivo da Factorial), buf }]. Devolve { manter, tirados, nivel, notas }.
async function conferirConteudo(pend, tipoNome, partes, nivel) {
  const notas = [];
  const manter = [];
  const tirados = [];
  const leituras = [];
  for (const parte of partes) {
    const r = lerPdf.conferir(await lerPdf.lerTexto(parte.buf), { tipo: CONTEUDO[tipoNome] || [], negativos: NEGATIVOS, contrato: pend.contrato, contratos: CONTRATOS });
    parte.a.conteudo = { lido: r.lido, tipo: r.tipo || [], negativos: r.negativos || [], contrato: r.contrato || null, motivo: r.motivo || null };
    if (r.lido && r.contrato && !r.contrato.achou && r.contrato.outros.length) {
      tirados.push({ filename: parte.a.filename, motivo: `o texto cita outro contrato (${r.contrato.outros.join(', ')}) e não o ${lerContrato(pend.contrato).num}` });
      continue;
    }
    manter.push(parte);
    leituras.push(r);
  }
  const lidas = leituras.filter((r) => r.lido);
  if (!lidas.length) {
    if (manter.length) notas.push('conteúdo não conferido (PDF sem texto: imagem escaneada)');
    return { manter, tirados, nivel, notas };
  }
  if (lidas.some((r) => r.contrato?.achou)) { nivel = 3; notas.push('o texto cita o contrato da pendência'); }
  if (lidas.some((r) => r.negativos.length)) { nivel = 1; notas.push(`o texto parece outro documento (${[...new Set(lidas.flatMap((r) => r.negativos))].join('; ')}): conferir`); }
  else if (lidas.some((r) => r.tipo.length)) { if (nivel < 3) nivel++; notas.push(`o texto confere com o tipo (${[...new Set(lidas.flatMap((r) => r.tipo))].join('; ')})`); }
  else { nivel = 1; notas.push('o texto não tem nenhuma palavra-chave do tipo pedido: conferir'); }
  // Arquivos escolhidos juntos costumam ser do mesmo conjunto: se um era de outro contrato, os outros também podem ser
  // (Brigada 356/2026, ficha 16: só um dos três citava o 4600029823 no texto).
  if (tirados.length) { nivel = 1; notas.push('outro arquivo do mesmo grupo era de outro contrato: conferir os que ficaram'); }
  return { manter, tirados, nivel, notas };
}

// Documentos de empresa na Factorial = pastas com HSEQ no nome.
async function documentosEmpresa() {
  const pastas = await p.todos('/documents/folders');
  const hseq = pastas.filter((f) => /hseq/i.test(f.name));
  const nomes = new Map(pastas.map((f) => [String(f.id), f.name]));
  const vistos = new Map();
  for (const f of hseq) {
    for (const d of await p.todos(`/documents/documents?folder_id=${f.id}`)) {
      if (d.deleted_at || !hseq.some((h) => String(h.id) === String(d.folder_id))) continue;
      vistos.set(String(d.id), { id: String(d.id), filename: d.filename, created_at: d.created_at, signature_status: d.signature_status || null,
        extension: d.extension, pasta: nomes.get(String(d.folder_id)) || null });
    }
  }
  return [...vistos.values()];
}

let rodando = null;
// Documento de COLABORADOR (tipo Trabalhista, 30/10): só os da lista dos 36 que vão ao Bernhoeft (docs/documentos-36.md),
// buscados um colaborador por vez nos documentos dele na Factorial (como o mobilizacao.js e o pacote.js).
// 95 e 112–116 usam o "achar" do pacote.js (REGRAS); 78 = ASO admissional/periódico (planilha da Milena: Atlas e Bernhoeft).
// "pend" reconhece a descrição do portal; a ordem importa (o primeiro que casar vale). unir = junta todos os arquivos achados.
const DOCS_COLAB = [
  { doc_id: 112, pend: /direcao defensiva/ },
  { doc_id: 115, pend: /primeiros socorros/ },
  { doc_id: 113, pend: /qualificacao/ },
  { doc_id: 114, pend: /integracao/ },
  { doc_id: 116, pend: /treinamento|\bnr ?\d|ordem de servico/, unir: true },
  { doc_id: 95, pend: /\bepi\b/ },
  { doc_id: 78, nome: 'ASO admissional/periódico', pend: /\baso\b|atestado de saude/, achar: /\baso\b|atestado de saude/, fora: /demissional/ },
  { doc_id: 79, nome: 'Ficha de registro', pend: /ficha de registro/, achar: /ficha de registro/ },
].map((d) => ({ ...(p.REGRAS.find((r) => r.doc_id === d.doc_id) || {}), ...d }));
// Busca de documento de empresa (pastas HSEQ): desligada, não está na lista dos 36. BUSCA_EMPRESA=1 religa.
const BUSCA_EMPRESA = process.env.BUSCA_EMPRESA === '1';
const ehColaborador = (pend) => pend.tipo === 'Trabalhista' || Boolean(String(pend.colaboradores || '').trim());
const nomesDe = (pend) => String(pend.colaboradores || '').split(',').map((s) => s.trim()).filter(Boolean);
const NIVEL = { alta: 3, 'média': 2, baixa: 1 };

// Acha o funcionário pelo nome exato (sem acento/maiúscula) e escolhe os arquivos dele do tipo pedido.
// Um arquivo = confiança média; vários = o mais novo, confiança baixa (116 une todos, média). O texto do PDF ajusta depois.
async function buscarColaborador(nome, regra, ctx) {
  const alvo = n(nome).trim();
  let f = ctx.funcs.filter((e) => n(e.full_name).trim() === alvo);
  if (f.length > 1) f = f.filter((e) => e.active !== false);
  if (!f.length) return { motivo: 'colaborador não achado na Factorial pelo nome' };
  if (f.length > 1) return { motivo: `${f.length} funcionários com esse nome na Factorial: alguém escolhe` };
  const e = f[0];
  const deixados = [];
  const cand = [];
  for (const d of await p.todos(`/documents/documents?employee_ids[]=${encodeURIComponent(e.id)}`)) {
    if (d.deleted_at) continue;
    const pasta = ctx.pastas[String(d.folder_id)] || null;
    const t = n(`${d.filename} ${pasta || ''}`);
    if (!regra.achar.test(t) || (regra.fora && regra.fora.test(t))) continue;
    if (!ASSINATURA_OK.has(d.signature_status)) { deixados.push({ filename: d.filename, motivo: `assinatura ${d.signature_status}` }); continue; }
    cand.push({ id: String(d.id), filename: d.filename, created_at: d.created_at, signature_status: d.signature_status || null, extension: d.extension, pasta });
  }
  cand.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const base = { funcionario_id: String(e.id), ativo: e.active !== false, candidatos: cand.length, deixados };
  if (!cand.length) return { ...base, usar: [], motivo: `nenhum arquivo de ${regra.nome} nos documentos do colaborador na Factorial` };
  if (regra.unir) return { ...base, usar: cand.slice(-MAX_ARQUIVOS), confianca: 'média', motivo: `${Math.min(cand.length, MAX_ARQUIVOS)} arquivo(s) unidos` };
  if (cand.length === 1) return { ...base, usar: cand, confianca: 'média', motivo: '1 arquivo do tipo nos documentos do colaborador' };
  return { ...base, usar: cand.slice(-1), confianca: 'baixa', motivo: `${cand.length} arquivos do tipo: usado o mais novo, conferir` };
}

// Uma pendência de colaborador: um PDF por colaborador em auto/<pasta>/<colaborador>/pacote.pdf. O item NÃO tem "pdf":
// o entregar.js só sobe documento de empresa (Etapa 6) e recusa este (o de colaborador entra pela Mobilização).
async function rodarColaborador(pend, e, ctx, log) {
  const regra = DOCS_COLAB.find((d) => d.pend.test(n(pend.descricao)));
  const nomes = nomesDe(pend);
  const pasta = `${p.slug(pend.contrato)}-${p.slug(pend.competencia || '')}-${p.slug(regra?.nome || pend.descricao)}`.slice(0, 90);
  const item = { pasta, pendencia: pend, tipo: regra ? regra.nome : null, doc_id: regra?.doc_id ?? null, por_colaborador: true,
    colaboradores: [], arquivos: [], deixados: [], estado: 'buscando', motivo: null, confianca: null };
  e.itens.push(item);
  const fim = (estado, motivo) => { item.estado = estado; item.motivo = motivo; if (estado === 'erro') item.erro = motivo; log(`${pend.contrato} · ${item.tipo || pend.descricao}: ${motivo}`); gravarEstado(e); };
  if (!regra) return fim('nao_encontrado', 'documento de colaborador fora da lista dos 36 (sem regra de busca)');
  if (!nomes.length) return fim('nao_encontrado', 'a pendência não diz o colaborador');
  log(`${pend.contrato} · ${regra.nome}: ${nomes.length} colaborador(es), um por vez`);
  for (const nome of nomes) {
    const c = await buscarColaborador(nome, regra, ctx);
    const sub = p.slug(nome);
    const col = { nome, funcionario_id: c.funcionario_id || null, ativo: c.ativo ?? null, candidatos: c.candidatos ?? 0, confianca: c.confianca || null,
      motivo: c.motivo, deixados: c.deixados || [], estado: 'buscando',
      arquivos: (c.usar || []).map((a) => ({ id: a.id, filename: a.filename, created_at: a.created_at, signature_status: a.signature_status, extension: a.extension, pasta: a.pasta })) };
    item.colaboradores.push(col);
    log(`  ${nome}: ${c.motivo}`);
    if (!col.arquivos.length) { col.estado = 'nao_encontrado'; gravarEstado(e); continue; }
    try {
      const destino = path.join(DIR, pasta, sub);
      fs.mkdirSync(path.join(destino, 'partes'), { recursive: true });
      const pdfs = await p.baixar(col.arquivos.map((a) => ({ it: { doc_id: regra.doc_id }, a })), destino, (m) => log(m));
      if (!pdfs.length) throw new Error('nenhum arquivo baixou');
      // Conteúdo: o PDF com texto precisa citar o nome do colaborador; sem o nome, cai para baixa.
      const alvo = lerPdf.normalizar(nome);
      const leituras = await Promise.all(pdfs.map((b) => lerPdf.lerTexto(b)));
      const lidas = leituras.filter((l) => l && !l.erro && l.temTexto);
      if (lidas.length) {
        const cita = lidas.some((l) => lerPdf.normalizar(l.texto).includes(alvo));
        col.conteudo = cita ? 'o texto cita o nome do colaborador' : 'o texto NÃO cita o nome do colaborador: conferir';
        if (cita && col.confianca === 'média' && !regra.unir) col.confianca = 'alta';
        if (!cita) col.confianca = 'baixa';
      } else col.conteudo = 'conteúdo não conferido (PDF sem texto: imagem escaneada)';
      const final = pdfs.length > 1 ? await p.unir(pdfs) : pdfs[0];
      fs.writeFileSync(path.join(destino, 'pacote.pdf'), final);
      col.pdf = `auto/${pasta}/${sub}/pacote.pdf`;
      col.kb = Math.round(final.length / 1024);
      col.unidos = pdfs.length;
      col.estado = 'pronto';
      log(`  → ${nome}: PDF pronto (${pdfs.length} arquivo(s), ${col.kb} KB, confiança ${col.confianca}; ${col.conteudo})`);
    } catch (err) {
      col.estado = 'erro'; col.erro = err.message;
      log(`  ✕ ${nome}: ${err.message}`);
    }
    gravarEstado(e);
  }
  // Para o painel (detalhe/arquivos): os arquivos de todos, com o caminho a partir da pasta do item.
  item.arquivos = item.colaboradores.flatMap((c) => c.arquivos.map((a) => ({ ...a, colaborador: c.nome, arquivo: a.arquivo ? `${p.slug(c.nome)}/${a.arquivo}` : undefined })));
  item.deixados = item.colaboradores.flatMap((c) => c.deixados.map((d) => ({ ...d, colaborador: c.nome })));
  const ok = item.colaboradores.filter((c) => c.estado === 'pronto');
  item.unidos = ok.length;
  if (ok.length) item.confianca = ok.map((c) => c.confianca).sort((a, b) => NIVEL[a] - NIVEL[b])[0];
  const faltam = item.colaboradores.filter((c) => c.estado !== 'pronto').map((c) => `${c.nome} (${c.erro || c.motivo})`);
  if (ok.length === nomes.length) return fim('pronto', `PDF pronto para ${ok.length} de ${nomes.length} colaborador(es)`);
  return fim(ok.length ? 'parcial' : item.colaboradores.some((c) => c.estado === 'erro') ? 'erro' : 'nao_encontrado',
    `${ok.length} de ${nomes.length} colaborador(es) com PDF; sem: ${faltam.join('; ')}`);
}

const ouvintes = []; // o painel recebe cada linha do passo a passo na hora (aba Ao vivo)
const lerEstado = () => { try { return JSON.parse(fs.readFileSync(ARQ_ESTADO, 'utf8')); } catch { return null; } };
const gravarEstado = (e) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARQ_ESTADO, JSON.stringify(e, null, 2)); };

// Roda a esteira para as pendências dadas. Uma vez por vez; o estado vai sendo gravado para o painel acompanhar.
async function rodar(pendentes, coletado_em, porque) {
  if (rodando) return rodando;
  const e = { inicio: new Date().toISOString(), coletado_em, porque, fim: null, erro: null, log: [], itens: [] };
  const log = (m) => {
    e.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
    gravarEstado(e);
    for (const f of ouvintes) { try { f(m); } catch {} }
  };
  rodando = (async () => {
    try {
      fs.rmSync(DIR, { recursive: true, force: true });
      log(`${pendentes.length} pendência(s) "Não Entregue" no Bernhoeft (leitura de ${coletado_em || '?'}).`);
      // Só os documentos da lista dos 36 (30/10, pedido do usuário): os do Bernhoeft são todos de colaborador.
      // Documento de empresa (AVCB, PCMSO, AET…) não está na lista e não é buscado.
      const docs = BUSCA_EMPRESA ? await documentosEmpresa() : [];
      let ctx = null;
      for (const pend of pendentes) {
        if (!ehColaborador(pend) && !BUSCA_EMPRESA) {
          e.itens.push({ pasta: null, pendencia: pend, tipo: null, arquivos: [], deixados: [], estado: 'nao_encontrado', motivo: 'documento de empresa: fora da lista dos 36, não é buscado' });
          log(`${pend.contrato} · ${pend.descricao}: fora da lista dos 36, não buscado`);
          gravarEstado(e);
          continue;
        }
        if (ehColaborador(pend)) {
          if (!ctx) {
            log('Pendência de colaborador: listando os funcionários da Factorial…');
            ctx = { funcs: await p.todos('/employees/employees'), pastas: Object.fromEntries((await p.todos('/documents/folders')).map((f) => [String(f.id), f.name])) };
          }
          try { await rodarColaborador(pend, e, ctx, log); } catch (err) {
            const it = e.itens.find((i) => i.pendencia === pend);
            if (it) { it.estado = 'erro'; it.erro = err.message; }
            log(`  ✕ ${err.message}`);
          }
          continue;
        }
        const esc = escolher(pend, docs, pendentes);
        const pasta = `${p.slug(pend.contrato)}-${p.slug(esc.tipo || pend.descricao)}`.slice(0, 90);
        const item = { pasta, pendencia: pend, tipo: esc.tipo, confianca: esc.confianca || null, motivo: esc.motivo, deixados: esc.deixados,
          arquivos: esc.usar.map((a) => ({ id: a.id, filename: a.filename, created_at: a.created_at, signature_status: a.signature_status, extension: a.extension, pasta: a.pasta, motivo: a.motivo })),
          estado: 'buscando' };
        e.itens.push(item);
        log(`${pend.contrato} · ${esc.tipo || pend.descricao}: ${esc.usar.length ? `${esc.usar.length} arquivo(s), confiança ${esc.confianca}` : esc.motivo}`);
        if (!esc.usar.length) { item.estado = 'nao_encontrado'; gravarEstado(e); continue; }
        try {
          const destino = path.join(DIR, pasta);
          fs.mkdirSync(path.join(destino, 'partes'), { recursive: true });
          const it = { doc_id: 'auto', nome: esc.tipo };
          const pdfs = await p.baixar(item.arquivos.map((a) => ({ it, a })), destino, (m) => log(m));
          if (!pdfs.length) throw new Error('nenhum arquivo baixou');
          // Conteúdo: tira as partes de outro contrato e ajusta a confiança pelo texto (conferirConteudo).
          const baixados = item.arquivos.filter((a) => a.arquivo && !a.erro).map((a, i) => ({ a, buf: pdfs[i] }));
          const cc = await conferirConteudo(pend, esc.tipo, baixados, esc.nivel);
          for (const t of cc.tirados) { item.deixados.push(t); log(`  – fora pelo conteúdo: ${t.filename} (${t.motivo})`); }
          item.conteudo = cc.notas;
          item.confianca = CONFIANCA[cc.nivel];
          for (const nota of cc.notas) log(`  conteúdo: ${nota}`);
          if (!cc.manter.length) { item.estado = 'nao_encontrado'; item.motivo = 'os arquivos achados são de outro contrato (pelo texto do PDF)'; gravarEstado(e); continue; }
          if (cc.manter.length < baixados.length) item.arquivos = item.arquivos.filter((a) => cc.manter.some((m) => m.a === a));
          const bufs = cc.manter.map((m) => m.buf);
          const final = bufs.length > 1 ? await p.unir(bufs) : bufs[0];
          fs.writeFileSync(path.join(destino, 'pacote.pdf'), final);
          item.pdf = `auto/${pasta}/pacote.pdf`;
          item.kb = Math.round(final.length / 1024);
          item.unidos = bufs.length;
          item.estado = 'pronto';
          log(`  → PDF pronto para subir: ${bufs.length} arquivo(s) unido(s), ${item.kb} KB`);
        } catch (err) {
          item.estado = 'erro'; item.erro = err.message;
          log(`  ✕ ${err.message}`);
        }
        gravarEstado(e);
      }
    } catch (err) {
      e.erro = err.message;
      log(`ERRO: ${err.message}`);
    } finally {
      e.fim = new Date().toISOString();
      const prontos = e.itens.filter((i) => i.estado === 'pronto').length;
      log(`Fim: ${prontos} de ${e.itens.length} pendência(s) com PDF pronto para subir. Nada foi enviado.`);
      rodando = null;
    }
  })();
  return rodando;
}

// Apaga o que a esteira produziu (para recomeçar a demonstração do zero).
function limpar() { if (!rodando) fs.rmSync(DIR, { recursive: true, force: true }); }

module.exports = { rodar, limpar, estado: () => ({ ...(lerEstado() || {}), rodando: Boolean(rodando) }), escolher, conferirConteudo, CONTRATOS, TIPOS, DOCS_COLAB, buscarColaborador, ehColaborador, ouvir: (f) => ouvintes.push(f) };

if (require.main === module && process.argv[2] === '--testar') {
  // node auto.js --testar cruzamento.json pendencias.json  (cruzamento do 14/10: escolhe sem baixar nada)
  const cruz = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const docs = [...new Map(cruz.empresa.flatMap((g) => g.achados).map((d) => [d.id, { id: d.id, filename: d.arquivo, created_at: d.criado, signature_status: d.assinatura }])).values()];
  const pendentes = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  for (const pend of pendentes) {
    const r = escolher(pend, docs, pendentes);
    console.log(`\n${pend.contrato} · ${r.tipo}: ${r.usar.length ? `confiança ${r.confianca} (${r.motivo})` : r.motivo}`);
    for (const a of r.usar) console.log(`   ✓ ${a.id} ${a.created_at} ${a.filename}`);
    for (const d of r.deixados) console.log(`   – fora: ${d.filename} (${d.motivo})`);
  }
}
