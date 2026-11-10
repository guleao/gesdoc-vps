// Passo 3 (10/11): o que cada robô faz com cada pendência vai para o Neon.
//   documento_eventos   uma linha por busca, montagem, conferência, trava, envio, segurar/soltar (robo, tipo, resultado, motivo,
//                       responsavel, detalhe, dados). Busca/conferência/trava só gravam quando o resultado MUDA (a rodada é de
//                       hora em hora: sem isso seriam milhares de linhas iguais); envio grava sempre.
//   documentos          motivo (código) + responsavel (cliente | operacao | sistema) + motivo_em de cada pendência aberta.
//   documento_protocolos uma linha por envio feito (tentativa 1, 2, ...).
// Sem as tabelas/colunas (Neon antigo), tudo vira no-op. Erro aqui nunca derruba busca nem envio: quem chama faz catch.
'use strict';

// Código do motivo -> quem tem que agir e o texto para pessoas. Quem é quem (critério do usuário, 06/11): "sistema" = falha do
// robô em buscar, conferir ou subir; "cliente" = falta arquivo ou definição na origem; "operacao" = uma pessoa da equipe tem
// que fazer algo (conferir e soltar, excluir o arquivo reprovado no portal, ligar o envio).
const MOTIVOS = {
  pronto: { responsavel: 'sistema', texto: 'pronto: sai na próxima rodada do envio automático' },
  enviado_aguardando: { responsavel: 'operacao', texto: 'enviado pelo robô, mas o Atlas ainda mostra como a enviar: conferir no portal' },
  segurado: { responsavel: 'operacao', texto: 'segurado no painel: conferir o PDF e soltar' },
  reprovado_portal: { responsavel: 'operacao', texto: 'reprovado no portal: excluir o arquivo antigo no Atlas antes de reenviar' },
  envio_bloqueado: { responsavel: 'operacao', texto: 'envio bloqueado no painel' },
  arquivo_repetido: { responsavel: 'operacao', texto: 'o mesmo arquivo está na pendência de outro funcionário: conferir em quem foi anexado' },
  arquivo_errado: { responsavel: 'operacao', texto: 'o conteúdo do PDF não confere com o pedido' },
  falta_arquivo: { responsavel: 'cliente', texto: 'o documento não está na origem (Factorial/SharePoint)' },
  aguardando_assinatura: { responsavel: 'cliente', texto: 'documento sem assinatura na origem' },
  definicao_pendente: { responsavel: 'cliente', texto: 'falta uma definição do cliente (qual arquivo, qual pasta, qual regra)' },
  fora_do_escopo: { responsavel: 'cliente', texto: 'não é da automação da Equatorial (outro projeto ou item que não existe para a NIP)' },
  pendencia_indevida: { responsavel: 'cliente', texto: 'pendência indevida no Atlas (ex.: rescisão de empregado ativo)' },
  erro_busca: { responsavel: 'sistema', texto: 'erro do robô ao buscar na origem' },
  erro_montagem: { responsavel: 'sistema', texto: 'erro do robô ao montar o PDF' },
  erro_envio: { responsavel: 'sistema', texto: 'erro do robô ao enviar ao portal' },
  aguardando_sincronizacao: { responsavel: 'sistema', texto: 'a sincronização Factorial (Evilásio) ainda não montou o documento' },
  sem_robo: { responsavel: 'sistema', texto: 'nenhum robô busca este tipo de documento ainda' },
  achado_nao_gravado: { responsavel: 'sistema', texto: 'achado na origem, mas ainda não gravado no banco' },
  enviado: { responsavel: null, texto: 'enviado ao portal' },
};

// Texto livre dos robôs -> código. A ordem importa (o primeiro que casa vale).
const REGRAS_TEXTO = [
  [/segurad/i, 'segurado'],
  [/envio bloqueado no painel/i, 'envio_bloqueado'],
  [/reprovad|precisa de ação no portal|já importado|22006|excluir o arquivo antigo|Rejected/i, 'reprovado_portal'],
  [/mesmo arquivo/i, 'arquivo_repetido'],
  [/^conteúdo:|CPF de outra|outro documento|clínic|anamnese/i, 'arquivo_errado'],
  [/ESCE|outro projeto|\bEDP\b|não existe para a NIP|sem regra para este tipo/i, 'fora_do_escopo'],
  [/empregado ativo|rescisão indevida/i, 'pendencia_indevida'],
  [/não encontrad|nenhum arquivo|não há pasta|sem o arquivo|pasta (está )?vazia|não achad|sem arquivo|sem documento|falta(m)? (o|a|os|as) |faltando|não tem o comprovante|não está na pasta/i, 'falta_arquivo'],
  [/assinatura|assinad/i, 'aguardando_assinatura'],
  [/possíve(l|is)|alguém escolhe|ambígu|não mapeada|sem par|\d+ pastas do projeto|definir|modelo|preench|Milena|Wellington|Lorena|Ediliz|cliente (tem que|precisa)|já sobe automático/i, 'definicao_pendente'],
  [/HTTP \d|timeout|ECONN|ETIMEDOUT|fetch failed|erro|falhou|recusou|exceção/i, 'erro'],
];

// tipo = etapa (para o "erro" virar erro_busca, erro_montagem ou erro_envio)
function classificar(texto, tipo = 'busca') {
  const t = String(texto || '');
  let codigo = null;
  for (const [re, c] of REGRAS_TEXTO) if (re.test(t)) { codigo = c; break; }
  const erroDa = { envio: 'erro_envio', montagem: 'erro_montagem' };
  if (codigo === 'erro') codigo = erroDa[tipo] || 'erro_busca';
  // Sem palavra conhecida: na busca é "não achou"; no envio, erro do envio; na conferência/trava, o arquivo não passou.
  if (!codigo) codigo = tipo === 'busca' ? 'falta_arquivo' : erroDa[tipo] || 'arquivo_errado';
  return { motivo: codigo, responsavel: MOTIVOS[codigo]?.responsavel ?? null };
}

const semUrl = (s) => String(s ?? '').replace(/postgres(ql)?:\/\/\S+/g, '<url>');

async function temTabela(sql, nome) {
  return (await sql.query(`select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [nome])).length > 0;
}
async function temColunas(sql, cols) {
  const r = await sql.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'documentos' and column_name = any($1)`, [cols]);
  return r.length === cols.length;
}

// eventos: [{ documento_id, robo, tipo, resultado, motivo, responsavel, detalhe, dados, sempre }]
// sempre = grava mesmo se o último evento (documento, robo, tipo) for igual (envio).
async function gravarEventos(sql, eventos, { log = () => {} } = {}) {
  const lista = eventos.filter((e) => e && e.documento_id != null);
  if (!lista.length || !(await temTabela(sql, 'documento_eventos'))) return 0;
  const ids = [...new Set(lista.map((e) => Number(e.documento_id)))];
  const ultimos = new Map();
  for (const r of await sql.query(`select distinct on (documento_id, robo, tipo) documento_id, robo, tipo, resultado, motivo, detalhe
      from documento_eventos where documento_id = any($1) order by documento_id, robo, tipo, em desc, id desc`, [ids])) {
    ultimos.set(`${r.documento_id}|${r.robo}|${r.tipo}`, r);
  }
  const novos = [];
  for (const e of lista) {
    const k = `${Number(e.documento_id)}|${e.robo}|${e.tipo}`;
    const u = ultimos.get(k);
    const detalhe = e.detalhe == null ? null : semUrl(e.detalhe).slice(0, 2000);
    if (!e.sempre && u && u.resultado === e.resultado && (u.motivo ?? null) === (e.motivo ?? null) && (u.detalhe ?? null) === detalhe) continue;
    ultimos.set(k, { resultado: e.resultado, motivo: e.motivo ?? null, detalhe });
    novos.push(sql.query(`insert into documento_eventos (documento_id, robo, tipo, resultado, motivo, responsavel, detalhe, dados)
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [Number(e.documento_id), e.robo, e.tipo, e.resultado, e.motivo ?? null, e.responsavel ?? null, detalhe, e.dados == null ? null : JSON.stringify(e.dados)]));
  }
  if (novos.length) await sql.transaction(novos);
  if (novos.length) log(`Eventos: ${novos.length} gravado(s) em documento_eventos (${lista.length - novos.length} iguais ao último, pulados).`);
  return novos.length;
}

// itens: [{ id, motivo, responsavel }] -> documentos.motivo/responsavel/motivo_em (só quem mudou).
async function atualizarMotivos(sql, itens) {
  const lista = itens.filter((x) => x && x.id != null);
  if (!lista.length || !(await temColunas(sql, ['motivo', 'responsavel', 'motivo_em']))) return 0;
  const r = await sql.query(`update documentos d set motivo = v.m, responsavel = v.r, motivo_em = now()
    from (select unnest($1::int[]) id, unnest($2::text[]) m, unnest($3::text[]) r) v
    where d.id = v.id and (d.motivo is distinct from v.m or d.responsavel is distinct from v.r) returning d.id`,
  [lista.map((x) => Number(x.id)), lista.map((x) => x.motivo ?? null), lista.map((x) => x.responsavel ?? null)]);
  return r.length;
}

// Um envio feito ao portal: linha em documento_protocolos (tentativa = próxima do documento nesse portal).
// protocolo é UNIQUE e NOT NULL: o id que o portal devolveu, ou "<portal>:<local>:<hora>".
async function gravarProtocolo(sql, { documento_id, plataforma = 'Atlas', protocolo, local, estado = null, texto = null }) {
  if (!(await temTabela(sql, 'documento_protocolos'))) return false;
  const p = protocolo || `${plataforma}:${local || documento_id}:${new Date().toISOString()}`;
  await sql.query(`insert into documento_protocolos (documento_id, plataforma, protocolo, data_protocolo, estado_protocolo, resultado_texto, tentativa)
    select $1, $2::varchar, $3, now(), $4, $5, coalesce(max(tentativa), 0) + 1 from documento_protocolos where documento_id = $1 and plataforma = $2::varchar`,
  [Number(documento_id), plataforma, p, estado, texto == null ? null : semUrl(texto).slice(0, 2000)]);
  return true;
}

// O id do arquivo que o portal devolveu no upload (corpo JSON), se houver.
function protocoloDaResposta(corpo) {
  try {
    const j = JSON.parse(corpo);
    const d = j?.data ?? j;
    const v = d?.id ?? d?.document_file_id ?? d?.uuid ?? d?.file_id ?? (Array.isArray(d) ? d[0]?.id : null);
    return v == null ? null : String(v);
  } catch { return null; }
}

module.exports = { MOTIVOS, classificar, gravarEventos, atualizarMotivos, gravarProtocolo, protocoloDaResposta, temTabela };
