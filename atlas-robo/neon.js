// Grava a última coleta (out/atlas.db) na tabela "documentos" do Neon (Postgres), via HTTPS.
// Também é chamado no fim do pendencias.js quando há conexão configurada.
//
// Conexão: variável ROBO_DATABASE_URL, ou ROBO_ENV_FILE apontando para um arquivo com a linha ROBO_DATABASE_URL=...
// (a senha nunca é impressa). O usuário robo_atlas só pode ler/inserir/atualizar; não apaga nada.
//
// Regras:
//   - Cada pendência precisa de um doc_id da tabela documento_regras. A tradução nome do Atlas -> doc_id fica em
//     REGRAS abaixo. Nome sem tradução = linha pulada e listada no log.
//   - Reprovados não são gravados à parte: já estão em Atrasados (situação "Reprovado (atrasado)").
//   - Linhas do robô são as que têm "aba" preenchida. As outras (cadastradas por outros processos) nunca são tocadas.
//   - Mesma pendência (mesma chave) em coletas seguintes = UPDATE da linha; nova = INSERT. Se a chave já existir no banco
//     (linha de outro processo), o INSERT é pulado (on conflict do nothing) em vez de derrubar a gravação.
//   - Reprovado depois de LOCALIZADO/COMPOSTO/ENVIADO: o trigger documentos_rejeicao do Neon muda o estado para REJEITADO
//     quando este UPDATE troca a situação; o robô não precisa fazer nada.
//   - estado = PENDENTE_ENVIO só na linha NOVA; no UPDATE o estado nunca é alterado (o serviço do Evilásio avança o estado).
// Uso: node neon.js            grava
//      node neon.js --simular  só mostra o que faria
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { neon } = require('@neondatabase/serverless');

const DB = process.env.ATLAS_DB || path.join(__dirname, 'out', 'atlas.db');
const ESTADO = 'PENDENTE_ENVIO';
const SITUACAO = { DelayNotSent: 'Não enviado no prazo', DelayRejected: 'Reprovado (atrasado)', PendingNotSent: 'A enviar', Rejected: 'Reprovado' };

// Nome do documento no Atlas (normalizado) -> doc_id em documento_regras.
// Pares de 19/10 pelo discovery da Milena (v2): "Comprovante de Pagamento do TRCT" -> 9 (ela pega um arquivo só, o comprovante
// do TRCT, em Offboarding) e "Folha de Pagamento Mensal Analítica" -> 63 (extrato mensal da folha, pasta FOPAG do SharePoint).
const REGRAS = {
  'vale alimentacao (relacao de beneficiarios + boleto + comprovante)': 2,
  'vale transporte (relacao de beneficiarios + boleto + comprovante)': 3,
  'seguro de vida (relacao de beneficiarios + boleto + comprovante)': 4,
  'plano odontologico (relacao de beneficiarios + boleto + comprovante)': 5,
  'vale refeicao (relacao de beneficiarios + boleto + comprovante)': 6,
  'plano de saude (relacao de beneficiarios + boleto + comprovante)': 7,
  'aviso + recibo de ferias + comprovante de pagamento': 8,
  'termo de rescisao do contrato de trabalho - trct': 9,
  'termo de rescisao contrato de trabalho (tcrt) com comprovante de pagamento': 9,
  'comprovante de pagamento do trct': 9,
  'guia do fgts digital rescisoria (gfd rescisoria) + comprovante de pagamento': 10,
  'fgts - guia de recolhimento (boleto)': 24,
  'fgts - re - relacao de empregados/trabalhadores': 25,
  'fgts - comprovante de pagamento': 26,
  'comprovante bancario de pagamento de salarios': 56,
  'comprovante de recolhimento': 59,
  'folha de pagamento mensal analitica': 63,
  'recibo de entrega da declaracao de debitos e creditos tributarios federais previdenciarios - dctfweb': 60,
  'relatorio da declaracao completa - dctfweb': 61,
  'certidao de regularidade do fgts ou cnd do fgts': 64,
  'darf - documento de arrecadacao de receitas federais': 65,
  'relatorio mensal de ocorrencias': 66,
  'aso demissional': 67,
  'baixa na ctps e/ou e-social': 68,
  'pedido de demissao ou carta de desligamento': 69,
  'aso admissional': 78,
  'cartao de ponto': 83,
  'cnd federal': 81,
  'acordo coletivo, convencao coletiva ou acordo individual de trabalho': 84,
};
const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

function conexao() {
  let url = process.env.ROBO_DATABASE_URL;
  if (!url && process.env.ROBO_ENV_FILE) {
    const l = fs.readFileSync(process.env.ROBO_ENV_FILE, 'utf8').split(/\r?\n/).find((x) => x.startsWith('ROBO_DATABASE_URL='));
    if (l) url = l.slice('ROBO_DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  return url || null;
}
const temConexao = () => !!conexao();

// Mesma pendência entre coletas = a chave única do Neon (índice documentos_chave_natural, NULLS NOT DISTINCT, 19/10):
// cliente + documento + quem (CPF ou CNPJ) + competência + nome + pedido + prazo. Tem que ser IGUAL à do banco: se o robô
// achar que é nova e o banco não, o INSERT bate na chave.
const CHAVE = ['cliente', 'doc_id', 'cpf', 'cnpj_filial', 'competencia', 'nome', 'numero_pedido', 'prazo_envio'];
const chave = (r) => CHAVE.map((c) => (r[c] == null ? '' : String(r[c]))).join('|');
const dia = (d) => (d == null ? null : d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Colunas gravadas em documentos (na ordem dos parâmetros).
const CAMPOS = ['doc_id', 'colaborador_id', 'competencia', 'estado', 'prazo_envio', 'cliente', 'unidade', 'nome', 'categoria', 'aba', 'situacao',
  'funcionario', 'cpf', 'tipo', 'grupo', 'numero_pedido', 'cnpj_filial', 'qtd_docs', 'enviado_em', 'validado_em', 'validade', 'critico'];

// CPF e CNPJ só com dígitos (no Neon: cpf varchar(11), cnpj_filial varchar(14)).
const digitos = (s) => (s ? String(s).replace(/\D/g, '') || null : null);

function montar(l, doc_id) {
  l = { ...l, cpf: digitos(l.cpf), cnpj_filial: digitos(l.cnpj_filial) };
  return {
    doc_id,
    colaborador_id: l.cpf || l.cnpj_filial,
    competencia: l.competencia,
    estado: ESTADO,
    prazo_envio: l.prazo_envio,
    cliente: l.cliente,
    unidade: l.unidades,
    nome: l.documento,
    categoria: l.categoria,
    aba: l.aba,
    situacao: SITUACAO[l.status] || l.status,
    funcionario: l.funcionario,
    cpf: l.cpf,
    tipo: l.tipo,
    grupo: l.grupos,
    numero_pedido: l.pedido,
    cnpj_filial: l.cnpj_filial,
    qtd_docs: l.n_docs,
    enviado_em: l.enviado_em,
    validado_em: l.validado_em,
    validade: l.validade,
    critico: !!l.critico,
  };
}

async function enviarNeon({ simular = false, log = console.log } = {}) {
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (defina ROBO_DATABASE_URL ou ROBO_ENV_FILE).');
  const sql = neon(url);

  const db = new DatabaseSync(DB, { readOnly: true });
  const coleta = db.prepare('SELECT * FROM coletas ORDER BY id DESC LIMIT 1').get();
  if (!coleta) throw new Error('Nenhuma coleta no banco local. Rode node pendencias.js antes.');
  const linhas = db.prepare(`SELECT * FROM pendencias WHERE coleta_id = ? AND aba <> 'Reprovados'`).all(coleta.id);
  db.close();

  const validos = new Set((await sql.query('select doc_id from documento_regras where ativo')).map((r) => r.doc_id));
  const registros = [];
  const semRegra = new Map();
  for (const l of linhas) {
    const doc = REGRAS[normalizar(l.documento)];
    if (!doc || !validos.has(doc)) semRegra.set(l.documento, (semRegra.get(l.documento) || 0) + 1);
    else registros.push(montar(l, doc));
  }

  // Linhas já gravadas pelo robô (aba preenchida), para atualizar em vez de duplicar.
  const existentes = new Map();
  for (const r of await sql.query(`select id, ${CHAVE.join(', ')} from documentos where aba is not null`)) {
    existentes.set(chave({ ...r, prazo_envio: dia(r.prazo_envio) }), r.id);
  }
  const vistos = new Set();
  const consultas = [];
  const inserts = []; // posição de cada INSERT em consultas
  let novos = 0;
  let atualizados = 0;
  for (const r of registros) {
    const k = chave(r);
    if (vistos.has(k)) continue; // mesma pendência repetida na coleta
    vistos.add(k);
    const vals = CAMPOS.map((c) => r[c] ?? null);
    const id = existentes.get(k);
    if (id) {
      atualizados++;
      // Não toca em estado: quem avança a pendência (COMPOSTO, LOCALIZADO, DIVERGENTE_FACTORIAL...) é o serviço de sincronização.
      const campos = CAMPOS.filter((c) => c !== 'estado');
      const valsUp = campos.map((c) => r[c] ?? null);
      consultas.push(sql.query(`update documentos set ${campos.map((c, i) => `${c} = $${i + 1}`).join(', ')}, atualizado_em = now() where id = $${campos.length + 1}`, [...valsUp, id]));
    } else {
      novos++;
      // Já existe no banco com a mesma chave (linha de outro processo, sem aba): não duplica nem derruba a transação inteira.
      inserts.push(consultas.length);
      consultas.push(sql.query(`insert into documentos (${CAMPOS.join(', ')}) values (${CAMPOS.map((_, i) => `$${i + 1}`).join(', ')})
        on conflict (${CHAVE.join(', ')}) do nothing returning id`, vals));
    }
  }

  log(`Neon: ${linhas.length} pendência(s) na coleta ${coleta.id}; ${novos} nova(s), ${atualizados} atualizada(s), ${registros.length - vistos.size} repetida(s), ${linhas.length - registros.length} sem regra.`);
  for (const [nome, n] of semRegra) log(`  sem regra (pulado): ${n}x ${nome}`);
  let jaExistiam = 0;
  if (simular) {
    log('Neon: simulação, nada gravado.');
  } else if (consultas.length) {
    const res = await sql.transaction(consultas);
    // INSERT que voltou sem id = já existia no banco.
    jaExistiam = inserts.filter((i) => !res[i].length).length;
    if (jaExistiam) log(`Neon: ${jaExistiam} nova(s) já existiam no banco com a mesma chave (de outro processo): puladas.`);
    log('Neon: gravado.');
  }
  return { novos: novos - jaExistiam, atualizados, jaExistiam, semRegra: [...semRegra] };
}

module.exports = { enviarNeon, temConexao, conexao };

if (require.main === module) {
  enviarNeon({ simular: process.argv.includes('--simular') }).catch((e) => {
    console.error('ERRO:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    process.exitCode = 1;
  });
}
