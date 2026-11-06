// Busca no SharePoint do RH os documentos de empresa das pendências do Atlas (SOMENTE LEITURA no SharePoint).
//
// Site igneos.sharepoint.com/sites/brasil/rh, biblioteca "Documentos" (o app AppRHBrasilSP tem Sites.Selected só nele).
// A busca do Graph (search) dá 500 com Sites.Selected: o robô percorre as pastas.
//   Mensais do projeto 20102080 (filial NIP MA, CNPJ ...0007-97, todas as unidades Equatorial):
//     13 Auditorias/Auditoria 20102080 Equatorial/<ano>/<pasta do mês>/<pasta do tipo>
//     a pasta do mês tem nome solto ("01.2026", "04 -Abril", "09-SETEMBRO"): vale o número ou o nome do mês.
//   Certidões: 13 Auditorias/0 - CERTIDÕES DE REGULARIDADE/<pasta do mês>: vale a mais nova ainda válida (data no nome), de qualquer mês
// Para cada linha do robô no Neon com estado PENDENTE_ENVIO e origem SharePoint:
//   aplica a regra do doc_id (pasta + nome do arquivo, e a unidade quando o arquivo é por tomador);
//   exatamente 1 PDF = achado; com --gravar baixa em out/downloads/sharepoint/<id do item>.pdf e grava no Neon
//   estado LOCALIZADO, caminho_origem "sharepoint:<id do item>", tamanho_bytes e hash_arquivo (como o factorial.js);
//   os de várias partes (benefícios 2, 3, 4, 7 e comprovantes de salário 56) são unidos pelo Gotenberg em
//   out/downloads/sharepoint/unido-<doc>-<MM-AAAA>[-<unidade>].pdf, na ordem relação -> boleto -> comprovante (complementar logo
//   depois da sua parte, nota fiscal fora); arquivo que o robô não sabe classificar, parte faltando ou repetida = não une e diz por quê;
//   0 ou mais de 1 = não mexe no Neon e só registra o motivo em out/envio/busca-sharepoint.json.
// Uso: node sharepoint.js [--baixar | --gravar]
//   sem nada  = simula: não baixa, não une nem grava (mostra as partes e a ordem);
//   --baixar  = baixa os achados e as partes e une, só para o painel mostrar; NÃO grava no Neon (é o que o robo.js roda);
//   --gravar  = baixa e grava LOCALIZADO (unido: COMPOSTO) no Neon (de produção: só com o OK do Augusto).
// Arquivo já baixado com o mesmo tamanho do SharePoint não é baixado de novo.
// Variáveis: SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET (obrigatórias), ROBO_DATABASE_URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');
const { conexao } = require('./neon');
const { OUT, log } = require('./comum');
const { unirPdfs } = require('./unir-pdfs');

const SITE = 'igneos.sharepoint.com:/sites/brasil/rh';
const RAIZ_MENSAL = '13 Auditorias/Auditoria 20102080 Equatorial';
const RAIZ_CERTIDOES = '13 Auditorias/0 - CERTIDÕES DE REGULARIDADE';
const FILIAL_20102080 = '02867678000797';
const PASTA = path.join(OUT, 'downloads', 'sharepoint');
const ARQ_BUSCA = path.join(OUT, 'envio', 'busca-sharepoint.json');
// De que arquivos e pasta saiu o PDF de cada pendência (id do Neon). Não é refeito a cada rodada como o busca-sharepoint.json:
// depois do --gravar a pendência sai da busca (deixa de ser PENDENTE_ENVIO), e o painel ainda precisa mostrar a montagem antes do envio.
const ARQ_MONTAGEM = path.join(OUT, 'envio', 'montagem-sharepoint.json');
const GRAPH = 'https://graph.microsoft.com/v1.0';

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
// "01.2026", "04 -Abril", "08- AGOSTO", "10-OUTUBRO" -> número do mês (ou null)
function mesDaPasta(nome) {
  const n = normalizar(nome);
  const i = MESES.findIndex((m) => n.includes(m));
  if (i >= 0) return i + 1;
  const m = n.match(/^(\d{1,2})\b/);
  return m && +m[1] >= 1 && +m[1] <= 12 ? +m[1] : null;
}
// Unidade do Atlas -> como ela aparece no nome do arquivo/pasta (estado ou CNPJ do tomador).
const UNIDADES = {
  'equatorial maranhao': /maranh|06 ?272 ?793/,
  'equatorial piaui': /piaui|06 ?840 ?748/,
  'equatorial goias': /goiai?s|equatorial go\b|01 ?543 ?032/, // "Goiais" e "EQUATORIAL GO" aparecem nos nomes
  'equatorial para': /\bpara\b|04 ?895 ?728/,
  'equatorial alagoas': /alagoas|12 ?272 ?084/,
  'equatorial rio grande do sul': /rio grande do sul|\brs\b|08 ?467 ?115/,
  cea: /amapa|\bcea\b|eletricidade do am\b|05 ?965 ?546/, // "FOPAG 07.2026 20102080 COMPANHIA DE ELETRICIDADE DO AM"
};
const PDF = (n) => /\.pdf$/i.test(n);
// Comprovante sem unidade no título (doc 26): arquivos { name } -> { cand, aviso }. Prefere os que citam a unidade; sem eles, os que não
// citam NENHUMA unidade (serve a todas); os que citam outra unidade nunca entram.
function filtrarPorUnidade(cand, unidadeAtlas) {
  const un = UNIDADES[normalizar(unidadeAtlas)];
  if (!un) return { cand: [], motivo: `unidade "${unidadeAtlas}" sem par no SharePoint` };
  const citaAlguma = (x) => Object.values(UNIDADES).some((re) => re.test(normalizar(x.name)));
  const daUnidade = cand.filter((x) => un.test(normalizar(x.name)));
  if (daUnidade.length) return { cand: daUnidade };
  const semUnidade = cand.filter((x) => !citaAlguma(x));
  return semUnidade.length ? { cand: semUnidade, aviso: 'o comprovante não cita a unidade no nome: o mesmo arquivo serve a todas as unidades (confirmar com a Milena)' } : { cand: [] };
}
// Convenção coletiva (doc 84): itens { name, caminho } -> { item, aviso } | { motivo }. A unidade aparece no nome ou na pasta; a vigência é o
// ano (ou o par "2025 2026") no nome: vale a que cobre o ano da competência; várias = a de vigência mais recente; empate = ninguém escolhe.
function escolherConvencao(itens, unidadeAtlas, ano) {
  const un = UNIDADES[normalizar(unidadeAtlas)];
  if (!un) return { motivo: `unidade "${unidadeAtlas}" sem par no SharePoint` };
  const da = itens.filter((x) => un.test(normalizar(`${x.caminho} ${x.name}`)));
  if (!da.length) return { motivo: `nenhuma convenção da unidade ${unidadeAtlas} em 06 Convenções Coletivas` };
  const anos = (x) => [...normalizar(`${x.caminho} ${x.name}`).matchAll(/\b(20\d\d)\b/g)].map((m) => +m[1]);
  const vigentes = da.filter((x) => { const a = anos(x); return a.length && Math.min(...a) <= ano && Math.max(...a) >= ano; });
  if (!vigentes.length) return { motivo: `nenhuma convenção da unidade ${unidadeAtlas} cobre ${ano} (${da.map((x) => x.name).join(', ')})` };
  const fim = (x) => Math.max(...anos(x));
  const topo = Math.max(...vigentes.map(fim)), melhores = vigentes.filter((x) => fim(x) === topo);
  if (melhores.length > 1) return { motivo: `${melhores.length} convenções possíveis para ${unidadeAtlas} em ${ano} (${melhores.map((x) => x.name).join(', ')}): alguém escolhe` };
  return { item: melhores[0], aviso: `convenção "${melhores[0].name}"${vigentes.length > 1 ? ` (${vigentes.length} vigentes: usada a mais recente)` : ''}: confirmar a vigência` };
}
// Pasta do tipo dentro do mês, pelas palavras do nome. Uma só casou = ela. Várias casaram e UMA tem o nome mais curto
// ("FGTS" x "FGTS rescisoria") = a mais curta, com aviso; empate = não escolhe (n pastas).
function escolherPasta(pastas, tipo) {
  const c = pastas.filter((x) => tipo.test(normalizar(x.name)));
  if (c.length <= 1) return { pasta: c[0] || null, n: c.length };
  const tam = c.map((x) => normalizar(x.name).length), min = Math.min(...tam);
  const curtas = c.filter((x, i) => tam[i] === min);
  if (curtas.length === 1) return { pasta: curtas[0], n: c.length, aviso: `${c.length} pastas casaram (${c.map((x) => x.name).join(', ')}): usada a de nome mais curto, "${curtas[0].name}"` };
  return { pasta: null, n: c.length };
}
// raiz: 'mensal' ou 'certidoes'; tipo: pasta dentro do mês (ausente = o próprio mês); achar: nome do arquivo; porUnidade: o arquivo é por tomador;
// porTomador: dentro do tipo há uma pasta por tomador ("Serviço 64 - EQUATORIAL MARANHÃO"); aviso: vai para o painel junto do achado.
// uniao 'beneficio': várias partes (relação de beneficiários, boleto, comprovante), unidas nessa ordem (ver papelBeneficio);
// uniao 'todos': une todos os PDFs da pasta, em ordem de nome, a não ser que já haja um unido (pronto).
// 03/11: pasta e arquivo são reconhecidos pelas PALAVRAS do nome, não pelo nome inteiro (pedido da equipe dos clientes).
// Se mais de uma pasta/arquivo casar, o robô não escolhe: trava com o motivo ("N pastas do tipo", "alguém escolhe").
const REGRAS = {
  24: { raiz: 'mensal', tipo: /\bfgts\b/, achar: (n) => /\bguia\b|\bgfd\b|\bboleto\b/.test(n) && !/comprovante|\bre\b|relacao/.test(n) },
  25: { raiz: 'mensal', tipo: /\bfgts\b/, achar: (n) => /\bre\b|relacao de (empregados|trabalhadores)/.test(n), porUnidade: true },
  // 26: o título do comprovante não traz a unidade (Milena). Vale o da unidade, se o nome a cita; senão o que não cita nenhuma (serve a todas, com aviso).
  26: { raiz: 'mensal', tipo: /\bfgts\b/, achar: (n) => /comprovante|recibo de pagamento/.test(n), unidadeOpcional: true },
  60: { raiz: 'mensal', tipo: /\binss\b/, achar: (n) => /recibo|entrega/.test(n) && /dctf ?web/.test(n) },
  61: { raiz: 'mensal', tipo: /\binss\b/, achar: (n) => /declaracao completa|relatorio completo|relatorio (da )?(declaracao|dctf)/.test(n) && !/recibo/.test(n) },
  // Na pasta INSS a guia ("GUIAS DARF'S", "DARF COMPLETA") e o comprovante dela ficam lado a lado, e às vezes um "DCTFWEB + DARF + COMPROVANTE".
  65: { raiz: 'mensal', tipo: /\binss\b/, achar: (n) => /\bdarf/.test(n) && !/comprovante/.test(n) && !/dctf/.test(n) },
  59: { raiz: 'mensal', tipo: /\binss\b/, achar: (n) => /\bdarf/.test(n) && /comprovante/.test(n) && !/dctf/.test(n),
    aviso: 'a Milena diz que o 59 "já sobe automático": confirmar quem envia antes de gravar (risco de envio em dobro)' },
  63: { raiz: 'mensal', tipo: /\bfopag\b|folha de pagamento|\bfolha\b/, achar: (n) => /\bfopag\b|extrato (mensal|da folha)|folha (de pagamento )?(mensal )?analitica/.test(n), porUnidade: true,
    aviso: 'a Milena diz que o 63 "já está automatizado" (Gabriela): confirmar quem envia antes de gravar (risco de envio em dobro)' },
  64: { raiz: 'certidoes', achar: (n) => /\bcrf\b|regularidade (do )?fgts|certificado de regularidade|\bcnd (do )?fgts|certidao.*\bfgts\b/.test(n) }, // "CERTIDÃO DE REGULARIDADE FGTS - 01.06.2026"
  // CND federal: a "positiva com efeitos de negativa" também vale (certidão válida), mas FGTS e trabalhista são outros documentos.
  81: { raiz: 'certidoes', achar: (n) => /certidao (negativa|positiva).*(federa|receita|pgfn|uniao)|\bcnd federal|\bcnd\b.*federa|tributos federais/.test(n) && !/fgts|trabalhist/.test(n) },
  // CNDT: a Milena tira no TST e não fica guardada; se alguém salvar na pasta das certidões, o robô passa a achar.
  82: { raiz: 'certidoes', achar: (n) => /\bcndt\b|debitos trabalhistas|certidao.*trabalhist/.test(n) },
  // Convenção coletiva (AC, CC ou AIT): pasta "06 Convenções Coletivas" na raiz da biblioteca; anual. Escolhe por unidade e vigência (escolherConvencao).
  84: { raiz: 'convencoes', achar: (n) => /convencao|acordo coletivo|acordo individual|\bcct\b|\bact\b|\bait\b|dissidio/.test(n) },
  // Benefícios: um PDF só por mês (o mesmo sobe em cada pendência do mês), relação -> boleto -> comprovante, sem nota fiscal.
  2: { raiz: 'mensal', tipo: /^v ?a$|\bv ?a\b|alimenta/, uniao: 'beneficio' },
  3: { raiz: 'mensal', tipo: /^v ?t$|\bv ?t\b|transporte|mobilidade/, uniao: 'beneficio' },
  4: { raiz: 'mensal', tipo: /seguro/, uniao: 'beneficio' },
  7: { raiz: 'mensal', tipo: /saude|assistencia medica/, uniao: 'beneficio' }, // "PLANO SAUDE" em 12-2025
  // Comprovantes de salário: um PDF por funcionário na pasta do tomador; a Milena baixa todos e une. A NIP às vezes já deixa
  // um "01 - Salarios - Equatorial MA.pdf" com todos: aí vale ele.
  56: { raiz: 'mensal', tipo: /^salario|comprovantes? de salario/, porTomador: true, uniao: 'todos', pronto: (n) => /^\d* ?salarios\b/.test(n) },
};
// Documentos que o robô procura aqui mesmo se a origem no banco disser outra coisa (82 CNDT: a origem certa é o TST, mas se alguém
// salvar a certidão na pasta de certidões o robô acha; 66 não tem busca).
const DOCS_FORCADOS = [82];
const SEM_REGRA = {
  6: 'Vale Refeição não é um arquivo: é uma declaração para cada colaborador (Milena). Falta saber quem escreve e se há modelo',
  66: 'Relatório mensal de ocorrências não vem do SharePoint: a Milena baixa o modelo no Atlas e preenche (a origem no banco está errada)',
  84: 'Convenção coletiva fica em "06 Convenções Coletivas" (não é mensal): falta a regra',
};
// Papel de cada arquivo da pasta de um benefício, pelo nome (nomes reais de 2025-2026: "Relatório-de-pedidos mob 80",
// "Projeto_2010008001_08-2026", "Mob2010008001_08-2026_complementar", "comp80", "NIP LOT 797_SAUDE_NF_", "Comprovante 1.344,00"...).
// pronto = a NIP já uniu ("Relação de Beneficiários + Boleto + Comprovante.pdf"); nf = nota fiscal, não vai; outro = não sei: trava a união.
function papelBeneficio(nome) {
  const n = normalizar(nome.replace(/\.pdf$/i, ''));
  const compl = /complem/.test(n);
  if (/beneficiarios ?\+ ?boleto ?\+ ?comprovante|vida ?\+ ?boleto ?\+ ?comprovante|^pdfsam|\bmerge\b/.test(n)) return { papel: 'pronto' };
  if (/\bnf\b|nota fiscal/.test(n) && !/boleto/.test(n)) return { papel: 'nf' };
  if (/boleto|cobranca|^projeto \d|^mob ?\d|^\d{8} \d{2} \d{4}\b/.test(n)) return { papel: 'boleto', compl };
  if (/relatorio de (resumo de )?pedidos?|relacao de (beneficiarios|colaboradores|funcionarios)|lista(gem)? de (beneficiarios|colaboradores|funcionarios)|\bbeneficiarios\b|\bvidas\b|mensalidade|demonstrativo|detalhamento|^dm\b/.test(n)) return { papel: 'relacao', compl };
  // "UNIMED - 29.740,90", "METROPOLITAN LIFE ... 2.483,56 GRUPO AP I": nome com valor em reais e nada mais = comprovante do banco.
  if (/comprovante|recibo de pagamento|\bpix\b|transferencia|^comp\b|^comp ?\d|\d,\d{2}\b/.test(n)) return { papel: 'comprovante', compl };
  return { papel: 'outro' };
}
const ORDEM_BENEFICIO = ['relacao', 'relacao+', 'boleto', 'boleto+', 'comprovante', 'comprovante+'];
const NOME_PAPEL = { relacao: 'relação', 'relacao+': 'relação complementar', boleto: 'boleto', 'boleto+': 'boleto complementar',
  comprovante: 'comprovante', 'comprovante+': 'comprovante complementar' };
// Escolhe as partes de um benefício: { pronto, aviso } | { itens (na ordem), deixados } | { erro }. Cada x ganha x.papel.
// Partes soltas completas = o robô monta na ordem certa, mesmo que a NIP já tenha unido: os unidos dela vêm fora de ordem (02/2026:
// boleto antes da relação), com nota fiscal e sem a relação (01 e 02/2025). O unido da NIP só vale quando não há partes, e com aviso.
function partesBeneficio(pdfs) {
  if (!pdfs.length) return { erro: 'pasta sem PDF' };
  for (const x of pdfs) { const p = papelBeneficio(x.name); x.papel = p.papel === 'pronto' || p.papel === 'nf' || p.papel === 'outro' ? p.papel : p.papel + (p.compl ? '+' : ''); }
  const prontos = pdfs.filter((x) => x.papel === 'pronto');
  const deixados = pdfs.filter((x) => x.papel === 'nf').map((x) => ({ nome: x.name, motivo: 'nota fiscal não vai (Milena)' }));
  const problemas = [];
  const outros = pdfs.filter((x) => x.papel === 'outro');
  if (outros.length) problemas.push(`não sei onde entra: ${outros.map((x) => x.name).join(', ')}`);
  const itens = [];
  for (const p of ORDEM_BENEFICIO) {
    const d = pdfs.filter((x) => x.papel === p);
    if (d.length > 1) problemas.push(`${d.length} arquivos de ${NOME_PAPEL[p]} (${d.map((x) => x.name).join(', ')})`);
    else if (!d.length && !p.endsWith('+')) problemas.push(`falta ${NOME_PAPEL[p]}`);
    else itens.push(...d);
  }
  if (!problemas.length) return { itens, deixados: [...deixados, ...prontos.map((x) => ({ nome: x.name, motivo: 'já unido pela NIP: o robô montou das partes, na ordem certa' }))] };
  if (prontos.length === 1) return { pronto: prontos[0], aviso: 'PDF unido pela NIP: conferir se está na ordem relação → boleto → comprovante e sem nota fiscal' };
  if (prontos.length > 1) return { erro: `${prontos.length} PDFs já unidos na pasta (${prontos.map((x) => x.name).join(', ')}) e as partes soltas não fecham: alguém escolhe` };
  return { erro: `não dá para unir: ${problemas.join('; ')}` };
}

let token = null;
async function entrar() {
  const t = process.env.SHAREPOINT_TENANT_ID, c = process.env.SHAREPOINT_CLIENT_ID, s = process.env.SHAREPOINT_CLIENT_SECRET;
  if (!t || !c || !s) throw new Error('SHAREPOINT_TENANT_ID/CLIENT_ID/CLIENT_SECRET não configuradas: a busca no SharePoint não roda.');
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: c, client_secret: s, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`login no Microsoft falhou (HTTP ${r.status} ${j.error || ''})`);
  token = j.access_token;
}
async function graph(caminho) {
  let r;
  for (let t = 0; t < 4; t++) { // 429/503 = limite: espera e tenta de novo
    r = await fetch(caminho.startsWith('http') ? caminho : GRAPH + caminho, { headers: { authorization: `Bearer ${token}` } });
    if (r.status !== 429 && r.status !== 503) break;
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`SharePoint respondeu ${r.status} em ${caminho.split('?')[0].slice(0, 80)}`);
  return r.json();
}
let drive = null;
const cacheFilhos = new Map();
async function filhos(itemId) {
  if (!cacheFilhos.has(itemId)) {
    const itens = [];
    let u = `/drives/${drive}/items/${itemId}/children?$select=id,name,folder,file,size,lastModifiedDateTime&$top=500`;
    while (u) { const j = await graph(u); if (!j) break; itens.push(...j.value); u = j['@odata.nextLink']; }
    cacheFilhos.set(itemId, itens);
  }
  return cacheFilhos.get(itemId);
}
const porCaminho = (cam) => graph(`/drives/${drive}/root:/${cam.split('/').map(encodeURIComponent).join('/')}`);

const br = (iso) => iso.split('-').reverse().join('/');
// Certidões: vale a mais nova ainda válida, de qualquer pasta de mês. A validade está no nome ("CRF - 27-10-2026", "... - 05-04-2027");
// a pasta do mês da competência muitas vezes nem existe (10/2026) e a de setembro ainda vale. so = id do único arquivo que serve.
async function certidaoValida(regra) {
  const base = await porCaminho(RAIZ_CERTIDOES);
  if (!base) return { erro: 'pasta das certidões não existe' };
  const hoje = new Date().toISOString().slice(0, 10);
  const achadas = [];
  for (const m of (await filhos(base.id)).filter((x) => x.folder)) {
    for (const x of (await filhos(m.id)).filter((y) => y.file && PDF(y.name) && regra.achar(normalizar(y.name)))) {
      const d = x.name.match(/(\d{2})[.\-_ ](\d{2})[.\-_ ](20\d{2})/);
      achadas.push({ x, m, validade: d ? `${d[3]}-${d[2]}-${d[1]}` : null });
    }
  }
  const porData = (lista) => lista.filter((c) => c.validade).sort((p, q) => q.validade.localeCompare(p.validade));
  const validas = porData(achadas).filter((c) => c.validade >= hoje);
  if (!validas.length) {
    const v = porData(achadas)[0];
    return { erro: !achadas.length ? 'nenhuma certidão deste tipo nas pastas de certidões'
      : v ? `a certidão mais nova venceu em ${br(v.validade)} (${v.m.name}/${v.x.name}): tirar outra` : 'certidão sem data de validade no nome: alguém confere' };
  }
  const c = validas[0], dias = Math.round((Date.parse(c.validade) - Date.parse(hoje)) / 864e5);
  return { pasta: c.m, caminho: `${RAIZ_CERTIDOES}/${c.m.name}`, so: c.x.id,
    aviso: `certidão válida até ${br(c.validade)}${dias <= 10 ? ` (vence em ${dias} dia(s): conferir antes de enviar)` : ''}` };
}

// Convenção coletiva: anda em "06 Convenções Coletivas" (até 3 níveis), acha os arquivos de convenção e escolhe o da unidade e vigência.
async function convencaoValida(regra, l) {
  const raiz = await graph(`/drives/${drive}/root?$select=id`);
  const tops = (await filhos(raiz.id)).filter((x) => x.folder && /convencao|convencoes/.test(normalizar(x.name)));
  if (tops.length !== 1) return { erro: tops.length ? `${tops.length} pastas de convenções na raiz` : 'pasta "06 Convenções Coletivas" não encontrada na raiz da biblioteca' };
  const achados = [];
  const andar = async (dir, caminho, nivel) => {
    for (const x of await filhos(dir.id)) {
      if (x.folder && nivel < 3) await andar(x, `${caminho}/${x.name}`, nivel + 1);
      else if (x.file && PDF(x.name) && regra.achar(normalizar(x.name))) achados.push({ name: x.name, caminho, x, dir });
    }
  };
  await andar(tops[0], tops[0].name, 0);
  const e = escolherConvencao(achados, l.unidade, Number(String(l.competencia || '').slice(-4)));
  if (!e.item) return { erro: e.motivo };
  return { pasta: e.item.dir, caminho: e.item.caminho, so: e.item.x.id, aviso: e.aviso };
}

// Pasta do mês da competência ("MM/AAAA"): mensal = <raiz>/<ano>/<mês>; certidões = a pasta da certidão válida (certidaoValida).
async function pastaDoMes(regra, competencia, l) {
  if (regra.raiz === 'convencoes') return convencaoValida(regra, l);
  if (regra.raiz === 'certidoes') return certidaoValida(regra);
  const m = String(competencia || '').match(/^(\d{2})\/(\d{4})$/);
  if (!m) return { erro: `competência "${competencia}" fora do formato MM/AAAA` };
  const base = await porCaminho(`${RAIZ_MENSAL}/${m[2]}`);
  if (!base) return { erro: `não há pasta ${m[2]} no 20102080` };
  const meses = (await filhos(base.id)).filter((x) => x.folder && mesDaPasta(x.name) === +m[1]);
  if (meses.length !== 1) return { erro: meses.length ? `${meses.length} pastas para o mês ${m[1]}/${m[2]}` : `não há pasta do mês ${m[1]}/${m[2]}` };
  return { pasta: meses[0], caminho: `${RAIZ_MENSAL}/${m[2]}/${meses[0].name}` };
}

// Baixa um item do SharePoint em PASTA/<id>.pdf (pula se já está lá com o mesmo tamanho). Devolve { buf, arq } ou { erro }.
async function baixar(item) {
  const arq = path.join(PASTA, `${item.id}.pdf`);
  try { if (item.size && fs.statSync(arq).size === item.size) return { buf: fs.readFileSync(arq), arq, ja: true }; } catch {}
  const res = await fetch(`${GRAPH}/drives/${drive}/items/${item.id}/content`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return { erro: `download falhou (HTTP ${res.status})` };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { erro: 'o arquivo baixado não é PDF' };
  fs.mkdirSync(PASTA, { recursive: true, mode: 0o700 });
  fs.writeFileSync(arq, buf, { mode: 0o600 });
  // No container o robô é root e o painel (1000) lê este arquivo: ele e as pastas até out/ (downloads/, sharepoint/)
  // ficam com o dono de out/, senão o painel não abre.
  try {
    const { uid, gid } = fs.statSync(OUT);
    for (let d = PASTA; d.startsWith(OUT + path.sep); d = path.dirname(d)) fs.chownSync(d, uid, gid);
    fs.chownSync(arq, uid, gid);
  } catch {}
  return { buf, arq };
}

// Une as partes (já baixadas) num PDF só, pelo Gotenberg (unir-pdfs.js), em PASTA/unido-<chave>.pdf. O mesmo arquivo serve a todas
// as pendências da chave (benefício: doc + mês). Só refaz se as partes mudaram: assinatura (id:tamanho de cada parte, na ordem)
// igual à do relatório anterior e o arquivo ainda lá = reaproveita.
const unioes = new Map();
let anterior = null;
function unir(chave, itens, partes) {
  if (!unioes.has(chave)) unioes.set(chave, (async () => {
    const falha = partes.find((p) => p.erro);
    if (falha) return { erro: `parte não baixada (${falha.nome}): ${falha.erro}` };
    const nome = `unido-${chave}`, arq = path.join(PASTA, `${nome}.pdf`);
    const assinatura = itens.map((x) => `${x.id}:${x.size}`).join(',');
    const antes = (anterior?.itens || []).find((i) => i.local === `${nome}.pdf`);
    if (antes?.assinatura !== assinatura || !fs.existsSync(arq)) {
      try { await unirPdfs({ arquivos: itens.map((x) => path.join(PASTA, `${x.id}.pdf`)), nome, saida: PASTA, substituir: true }); }
      catch (e) { return { erro: `não uniu as partes: ${e.message}` }; }
      try { const { uid, gid } = fs.statSync(PASTA); fs.chownSync(arq, uid, gid); fs.chmodSync(arq, 0o600); } catch {}
    }
    const buf = fs.readFileSync(arq);
    return { arq, buf, assinatura, hash: crypto.createHash('sha256').update(buf).digest('hex') };
  })());
  return unioes.get(chave);
}

// O painel lê este arquivo: relatório inteiro, gravado de uma vez (nunca pela metade) e legível pelo usuário do painel.
function gravarJson(arq, obj) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = arq + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  try { const { uid, gid } = fs.statSync(path.dirname(arq)); fs.chownSync(tmp, uid, gid); } catch {}
  fs.renameSync(tmp, arq);
}
const gravarRelatorio = (rel) => gravarJson(ARQ_BUSCA, rel);

// Guarda a montagem de cada pendência com PDF pronto (a última vence); as que não foram achadas nesta rodada ficam como estavam.
function gravarMontagens(rel) {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(ARQ_MONTAGEM, 'utf8')) || {}; } catch {}
  for (const r of rel.itens.filter((i) => i.achou && i.local)) {
    m[r.id] = { em: rel.em, modo: rel.modo, doc_id: r.doc_id, competencia: r.competencia, unidade: r.unidade, pasta: r.pasta || null,
      arquivo: r.arquivo || null, sharepoint_id: r.sharepoint_id || null, modificado: r.modificado || null, local: r.local, unido: !!r.unido,
      assinatura: r.assinatura || null, aviso: r.aviso || null, deixados: r.deixados || [], partes: r.partes || [] };
  }
  gravarJson(ARQ_MONTAGEM, m);
}

// Para o teste (teste/t-achar-arquivo.js) ler as regras sem rodar a busca.
module.exports = { REGRAS, UNIDADES, papelBeneficio, mesDaPasta, escolherPasta, filtrarPorUnidade, escolherConvencao, normalizar };

if (require.main === module) (async () => {
  const gravar = process.argv.includes('--gravar');
  const baixa = gravar || process.argv.includes('--baixar');
  const modo = gravar ? 'gravar' : baixa ? 'baixar' : 'simulacao';
  try { anterior = JSON.parse(fs.readFileSync(ARQ_BUSCA, 'utf8')); } catch {}
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (ROBO_DATABASE_URL).');
  const sql = neon(url);
  const linhas = await sql.query(`select d.id, d.doc_id, d.nome, d.competencia, d.unidade, d.cnpj_filial from documentos d
    join documento_regras r on r.doc_id = d.doc_id
    where d.aba is not null and d.estado = 'PENDENTE_ENVIO' and (r.origem = 'SharePoint' or d.doc_id = any($1)) order by d.doc_id, d.competencia, d.id`, [DOCS_FORCADOS]);
  log(`Busca no SharePoint (${modo === 'baixar' ? 'baixa para o painel, não grava no banco' : modo}): ${linhas.length} pendência(s) de documento de empresa.`);
  const relatorio = { em: new Date().toISOString(), modo, itens: [] };
  if (linhas.length) {
    await entrar();
    const site = await graph(`/sites/${SITE}?$select=id`);
    if (!site) throw new Error('site do SharePoint não encontrado (ou o app perdeu o acesso)');
    drive = (await graph(`/sites/${site.id}/drive?$select=id`)).id;
    for (const l of linhas) {
      const r = { id: l.id, doc_id: l.doc_id, nome: l.nome, competencia: l.competencia, unidade: l.unidade };
      relatorio.itens.push(r);
      r.achou = false;
      const regra = REGRAS[l.doc_id];
      if (!regra) { r.motivo = SEM_REGRA[l.doc_id] || 'sem regra para este tipo'; continue; }
      if (String(l.cnpj_filial).replace(/\D/g, '') !== FILIAL_20102080) { r.motivo = `filial ${l.cnpj_filial} não é a do 20102080 (Equatorial): pasta ainda não mapeada`; continue; }
      const mes = await pastaDoMes(regra, l.competencia, l);
      if (mes.erro) { r.motivo = mes.erro; continue; }
      let pasta = mes.pasta, caminho = mes.caminho;
      if (regra.tipo) {
        const escolha = escolherPasta((await filhos(pasta.id)).filter((x) => x.folder), regra.tipo);
        if (!escolha.pasta) { r.motivo = escolha.n ? `${escolha.n} pastas do tipo em ${caminho}` : `não há pasta deste tipo em ${caminho}`; continue; }
        pasta = escolha.pasta; caminho += `/${pasta.name}`;
        if (escolha.aviso) mes.aviso = [mes.aviso, escolha.aviso].filter(Boolean).join('; ');
      }
      const un = UNIDADES[normalizar(l.unidade)];
      if (regra.porTomador) {
        let sub = (await filhos(pasta.id)).filter((x) => x.folder);
        const pt = sub.filter((x) => /por tomador/.test(normalizar(x.name)));
        if (pt.length === 1) { pasta = pt[0]; caminho += `/${pasta.name}`; sub = (await filhos(pasta.id)).filter((x) => x.folder); }
        if (!un) { r.motivo = `unidade "${l.unidade}" sem par no SharePoint (pendência de várias unidades?)`; continue; }
        const tom = sub.filter((x) => un.test(normalizar(x.name)));
        if (tom.length !== 1) { r.motivo = tom.length ? `${tom.length} pastas de tomador para ${l.unidade} em ${caminho}` : `não há pasta do tomador ${l.unidade} em ${caminho}`; continue; }
        pasta = tom[0]; caminho += `/${pasta.name}`;
      }
      // "07-JULHO/seguro/NIP GRUPO AP I/": pasta sem arquivo e com uma subpasta só = os arquivos estão nela.
      for (let i = 0; i < 3; i++) {
        const it = await filhos(pasta.id), sub = it.filter((x) => x.folder);
        if (it.some((x) => x.file) || sub.length !== 1) break;
        pasta = sub[0]; caminho += `/${pasta.name}`;
      }
      r.pasta = caminho;
      const avisos = [regra.aviso, mes.aviso].filter(Boolean);
      if (avisos.length) r.aviso = avisos.join('; ');
      const arquivos = (await filhos(pasta.id)).filter((x) => x.file);
      const pdfs = arquivos.filter((x) => PDF(x.name)).sort((x, y) => x.name.localeCompare(y.name, 'pt-BR', { numeric: true }));
      let a = null; // arquivo único achado
      if (regra.uniao) {
        // Escolha das partes: { pronto } = já unido pela NIP (vale como arquivo único) | { itens } = unir nessa ordem | { erro }.
        const esc = regra.uniao === 'beneficio' ? partesBeneficio(pdfs)
          : (() => { const p = pdfs.filter((x) => regra.pronto(normalizar(x.name)));
            return p.length === 1 ? { pronto: p[0] } : p.length > 1 ? { erro: `${p.length} PDFs já unidos na pasta: alguém escolhe` }
              : pdfs.length ? { itens: pdfs, deixados: [] } : { erro: 'pasta sem PDF' }; })();
        const deixados = [...(esc.deixados || []), ...arquivos.filter((x) => !PDF(x.name)).map((x) => ({ nome: x.name, motivo: 'não é PDF' }))];
        if (deixados.length) r.deixados = deixados;
        if (esc.aviso) r.aviso = [r.aviso, esc.aviso].filter(Boolean).join('; ');
        if (esc.pronto) a = esc.pronto;
        else {
          // Partes para o painel: as escolhidas na ordem da união, ou (se travou) todas as da pasta com o papel que o robô deu.
          const lista = esc.itens || pdfs;
          r.partes = [];
          for (const x of lista) {
            const p = { nome: x.name, sharepoint_id: x.id, modificado: String(x.lastModifiedDateTime || '').slice(0, 10) };
            if (x.papel) p.papel = NOME_PAPEL[x.papel] || { nf: 'nota fiscal (não vai)', outro: 'não sei' }[x.papel] || x.papel;
            if (baixa) { const b = await baixar(x); if (b.erro) p.erro = b.erro; else p.local = path.basename(b.arq); }
            r.partes.push(p);
          }
          if (esc.erro) { r.motivo = esc.erro; continue; }
          r.achou = true;
          r.unido = true;
          r.arquivo = `PDF unido de ${lista.length} parte(s)`;
          if (!baixa) { r.motivo = 'simulação: não unido'; continue; }
          const u = await unir(`${l.doc_id}-${String(l.competencia).replace('/', '-')}${regra.porTomador ? '-' + normalizar(l.unidade).replace(/\W+/g, '-') : ''}`, lista, r.partes);
          if (u.erro) { r.achou = false; r.motivo = u.erro; continue; }
          r.local = path.basename(u.arq);
          r.assinatura = u.assinatura;
          if (!gravar) { r.motivo = 'unido só para o painel: o banco continua PENDENTE_ENVIO'; continue; }
          await sql.query(`update documentos set estado = 'COMPOSTO', caminho_origem = $2, tamanho_bytes = $3, hash_arquivo = $4, atualizado_em = now()
            where id = $1 and estado = 'PENDENTE_ENVIO'`, [l.id, `sharepoint:${path.parse(u.arq).name}`, u.buf.length, u.hash]);
          log(`#${l.id} ${l.nome} (${l.competencia}): unido de ${lista.length} parte(s) do SharePoint, ${u.buf.length} bytes -> COMPOSTO`);
          continue;
        }
      } else {
        let cand = arquivos.filter((x) => regra.achar(normalizar(x.name)) && (!mes.so || x.id === mes.so));
        if (regra.porUnidade) {
          if (!un) { r.motivo = `unidade "${l.unidade}" sem par no SharePoint (pendência de várias unidades?)`; r.candidatos = cand.map((x) => x.name); continue; }
          cand = cand.filter((x) => un.test(normalizar(x.name)));
        } else if (regra.unidadeOpcional) {
          const f = filtrarPorUnidade(cand, l.unidade);
          if (f.motivo) { r.motivo = f.motivo; continue; }
          cand = f.cand;
          if (f.aviso) r.aviso = [r.aviso, f.aviso].filter(Boolean).join('; ');
        }
        const aptos = cand.filter((x) => PDF(x.name));
        if (aptos.length !== 1) {
          r.motivo = !cand.length ? `nenhum arquivo deste tipo em ${caminho}` : !aptos.length ? 'arquivo achado, mas não é PDF'
            : `${aptos.length} arquivos possíveis: alguém escolhe`;
          r.candidatos = cand.map((x) => x.name);
          continue;
        }
        a = aptos[0];
      }
      Object.assign(r, { achou: true, sharepoint_id: a.id, arquivo: a.name, modificado: String(a.lastModifiedDateTime || '').slice(0, 10) });
      if (!baixa) { r.motivo = 'simulação: não baixado'; continue; }
      const b = await baixar(a);
      if (b.erro) { r.achou = false; r.motivo = b.erro; continue; }
      const { buf } = b;
      r.local = path.basename(b.arq);
      if (!gravar) { r.motivo = 'baixado só para o painel: o banco continua PENDENTE_ENVIO'; continue; }
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      // Só avança quem ainda está PENDENTE_ENVIO (se outro processo mexeu no meio, não sobrescreve).
      await sql.query(`update documentos set estado = 'LOCALIZADO', caminho_origem = $2, tamanho_bytes = $3, hash_arquivo = $4, atualizado_em = now()
        where id = $1 and estado = 'PENDENTE_ENVIO'`, [l.id, `sharepoint:${a.id}`, buf.length, hash]);
      log(`#${l.id} ${l.nome} (${l.competencia}): achado no SharePoint ${a.name}, ${buf.length} bytes -> LOCALIZADO`);
    }
  }
  const achados = relatorio.itens.filter((x) => x.achou).length;
  for (const x of relatorio.itens.filter((i) => !i.achou)) log(`#${x.id} doc ${x.doc_id} (${x.competencia}, ${x.unidade}): ${x.motivo}`);
  for (const x of relatorio.itens.filter((i) => i.achou)) log(`#${x.id} doc ${x.doc_id} (${x.competencia}, ${x.unidade}): ACHADO ${x.pasta}/${x.arquivo}`);
  log(`Busca no SharePoint: ${achados} achado(s), ${relatorio.itens.length - achados} sem documento${gravar ? '' : baixa ? ' (baixados só para o painel: nada gravado no banco)' : ' (simulação: nada baixado nem gravado)'}.`);
  gravarRelatorio(relatorio);
  if (baixa) gravarMontagens(relatorio);
})().catch((e) => {
  const msg = String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>');
  console.error('ERRO:', msg);
  // O painel mostra a falha; o resultado da última busca boa continua valendo.
  try { gravarRelatorio({ ...(JSON.parse(fs.readFileSync(ARQ_BUSCA, 'utf8')) || {}), erro: msg, erro_em: new Date().toISOString() }); } catch { try { gravarRelatorio({ itens: [], erro: msg, erro_em: new Date().toISOString() }); } catch {} }
  process.exitCode = 1;
});
