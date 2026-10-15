// Esteira automática Bernhoeft, sem ninguém escolher nada:
//   1. pega as pendências "Não Entregue" que o robô Bernhoeft gravou (pendencias.json);
//   2. para cada uma, acha na Factorial (pastas HSEQ) os arquivos do tipo pedido e escolhe os do contrato/estado certo;
//   3. baixa, converte e une num PDF só (pacote.js) e deixa pronto para subir.
// SOMENTE LEITURA na Factorial e nada é enviado ao Bernhoeft. Saída em PACOTES/auto/<pasta>/ e PACOTES/auto/estado.json.
// Teste da escolha sem rede: node auto.js --testar cruzamento.json pendencias.json
const fs = require('fs');
const path = require('path');
const p = require('./pacote');

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
  const outrosNums = new Set(todasPendencias.map((x) => lerContrato(x.contrato).num).filter((x) => x && x !== ct.num));
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
      log('Listando os documentos de empresa na Factorial (pastas HSEQ)…');
      const docs = await documentosEmpresa();
      log(`${docs.length} documento(s) de empresa na Factorial.`);
      for (const pend of pendentes) {
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
          const final = pdfs.length > 1 ? await p.unir(pdfs) : pdfs[0];
          fs.writeFileSync(path.join(destino, 'pacote.pdf'), final);
          item.pdf = `auto/${pasta}/pacote.pdf`;
          item.kb = Math.round(final.length / 1024);
          item.unidos = pdfs.length;
          item.estado = 'pronto';
          log(`  → PDF pronto para subir: ${pdfs.length} arquivo(s) unido(s), ${item.kb} KB`);
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

module.exports = { rodar, limpar, estado: () => ({ ...(lerEstado() || {}), rodando: Boolean(rodando) }), escolher, TIPOS, ouvir: (f) => ouvintes.push(f) };

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
