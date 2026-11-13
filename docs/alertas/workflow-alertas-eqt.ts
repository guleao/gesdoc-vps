// Workflow "Alertas EQT" (n8n.stant-ad.com, id VyMevTW3eJwG46PC), no formato do SDK do n8n.
// Versão publicada em 11/11/2026. Ao mudar o workflow no n8n, atualizar este arquivo.
import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';

const agendamento = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.3,
  config: {
    name: 'Todo dia às 8h',
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 0 8 * * *' }] } },
    position: [0, 0]
  },
  output: [{}]
});

const buscarAlertas = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Buscar prazos e rejeições não avisados',
    parameters: {
      operation: 'executeQuery',
      query: "WITH prazo AS (\n  SELECT s.id, 'PRAZO'::text AS tipo,\n         CASE WHEN s.dias_para_prazo <= 0 THEN 0 WHEN s.dias_para_prazo = 1 THEN 1 WHEN s.dias_para_prazo <= 3 THEN 3 ELSE 7 END AS marco,\n         trim(r.email_responsavel) AS email, s.portal, s.unidade, s.documento AS nome, s.competencia,\n         s.prazo_envio::text AS prazo, s.dias_para_prazo AS dias, s.situacao_portal AS situacao,\n         COALESCE(s.motivo_descricao, s.motivo) AS motivo, NULL::text AS enviado_em, s.responsavel AS quem,\n         d.funcionario, d.cpf, d.cnpj_filial, d.numero_pedido AS pedido\n    FROM v_solicitacoes s\n    JOIN documentos d ON d.id = s.id\n    JOIN documento_regras r ON r.doc_id = s.doc_id\n   WHERE s.etapa = 'PENDENTE'\n     AND s.dias_para_prazo BETWEEN 0 AND 7\n     AND s.cliente ILIKE 'Equatorial%'\n     AND trim(r.email_responsavel) <> ''\n),\nvencido AS (\n  SELECT s.id, 'VENCIDO'::text, -1,\n         trim(r.email_responsavel), s.portal, s.unidade, s.documento, s.competencia,\n         s.prazo_envio::text, s.dias_para_prazo, s.situacao_portal,\n         COALESCE(s.motivo_descricao, s.motivo), NULL::text, s.responsavel,\n         d.funcionario, d.cpf, d.cnpj_filial, d.numero_pedido\n    FROM v_solicitacoes s\n    JOIN documentos d ON d.id = s.id\n    JOIN documento_regras r ON r.doc_id = s.doc_id\n   WHERE s.etapa = 'PENDENTE'\n     AND (s.dias_para_prazo < 0 OR s.situacao_portal = 'ATRASADO')\n     AND s.cliente ILIKE 'Equatorial%'\n     AND trim(r.email_responsavel) <> ''\n     AND NOT EXISTS (\n       SELECT 1 FROM alerta a\n        WHERE a.documento_id = s.id\n          AND a.tipo_alerta = 'DOCUMENTO_VENCIDO'\n          AND a.data_prevista_evento IS NOT DISTINCT FROM s.prazo_envio\n     )\n),\nrejeitado AS (\n  SELECT d.id, 'REJEITADO'::text, NULL::int,\n         trim(r.email_responsavel), d.portal, d.unidade, d.nome, d.competencia,\n         d.prazo_envio::text, NULL::int, d.situacao::text, COALESCE(d.motivo_reprovacao, 'não informado'), d.enviado_em::date::text, NULL::text,\n         d.funcionario, d.cpf, d.cnpj_filial, d.numero_pedido\n    FROM v_solicitacoes s\n    JOIN documentos d ON d.id = s.id\n    JOIN documento_regras r ON r.doc_id = d.doc_id\n    LEFT JOIN documento_destinos dd ON dd.documento_id = d.id AND dd.destino = 'Atlas'\n   WHERE d.cliente ILIKE 'Equatorial%'\n     AND (s.status_envio = 'REPROVADO' OR d.situacao ILIKE 'Reprovado%' OR d.situacao = 'PendingRejected')\n     AND trim(r.email_responsavel) <> ''\n     AND NOT EXISTS (\n       SELECT 1 FROM alerta a\n        WHERE a.documento_id = d.id\n          AND a.tipo_alerta = 'DOCUMENTO_REJEITADO'\n          AND a.criado_em >= COALESCE(dd.atualizado_em, d.criado_em)\n          AND a.descricao = 'Reprovação avisada por e-mail. Motivo: ' || left(COALESCE(d.motivo_reprovacao, 'não informado'), 900)\n     )\n)\nSELECT p.* FROM prazo p\n WHERE NOT EXISTS (\n   SELECT 1 FROM alerta a\n    WHERE a.documento_id = p.id\n      AND a.tipo_alerta = 'PRAZO_VENCIMENTO'\n      AND a.data_prevista_evento = p.prazo::date\n      AND a.dias_antecedencia_acionado = p.marco\n )\nUNION ALL\nSELECT * FROM vencido\nUNION ALL\nSELECT * FROM rejeitado\nORDER BY email, tipo, dias, unidade, nome"
    },
    credentials: { postgres: newCredential('Neon GesDoc') },
    position: [272, 0]
  },
  output: [{ id: 1, tipo: 'VENCIDO', marco: -1, email: 'responsavel@exemplo.com', portal: 'Atlas', unidade: 'EQUATORIAL PIAUÍ', nome: 'Vale Transporte', competencia: '10/2026', prazo: '2026-11-10', dias: -1, situacao: 'ATRASADO', motivo: 'O documento não está na Factorial ou no SharePoint', enviado_em: null, quem: 'CLIENTE', funcionario: null, cpf: null, cnpj_filial: '02867678000797', pedido: '00007' }]
});

const montarEmails = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Montar um e-mail por responsável',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: `const esc = (v) => String(v ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>');
const dataBr = (v) => (v ? v.slice(0, 10).split('-').reverse().join('/') : null);
const diasTexto = (n) => (n === null || n === undefined ? null : Math.abs(Number(n)) + (Math.abs(Number(n)) === 1 ? ' dia' : ' dias'));
const QUEM = { CLIENTE: 'Cliente', SISTEMA: 'Sistema', NENHUM: null };
const quemTexto = (v) => (v in QUEM ? QUEM[v] : v);
const digitos = (v) => String(v ?? '').replace(/\\D/g, '');
const cpfFmt = (v) => { const c = digitos(v); return c.length === 11 ? c.slice(0, 3) + '.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-' + c.slice(9) : (c || null); };
const cnpjFmt = (v) => { const c = digitos(v); return c.length === 14 ? c.slice(0, 2) + '.' + c.slice(2, 5) + '.' + c.slice(5, 8) + '/' + c.slice(8, 12) + '-' + c.slice(12) : (c || null); };
const deQuem = (d) => {
  const linhas = [];
  if (d.funcionario && String(d.funcionario).trim()) {
    linhas.push(String(d.funcionario).trim());
    if (cpfFmt(d.cpf)) linhas.push('CPF ' + cpfFmt(d.cpf));
  } else {
    linhas.push('Empresa');
    if (cnpjFmt(d.cnpj_filial)) linhas.push('CNPJ ' + cnpjFmt(d.cnpj_filial));
  }
  if (d.pedido) linhas.push('Pedido ' + d.pedido);
  return linhas.join('\\n');
};
const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #ccc"';
const td = 'style="padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top"';
const tabela = (colunas, linhas) => '<table style="border-collapse:collapse;font-size:13px"><thead><tr>'
  + colunas.map((c) => '<th ' + th + '>' + c + '</th>').join('') + '</tr></thead><tbody>'
  + linhas.map((l) => '<tr>' + l.map((v) => '<td ' + td + '>' + esc(v) + '</td>').join('') + '</tr>').join('')
  + '</tbody></table>';
const titulo = (texto, n, cor) => '<h3 style="margin:20px 0 8px;color:' + cor + '">' + texto + ' (' + n + ')</h3>';

const MARCOS = [
  [0, 'Vence hoje', '#b42318'],
  [1, 'Vence amanhã', '#b42318'],
  [3, 'Vence em até 3 dias', '#b54708'],
  [7, 'Vence em até 7 dias', '#344054'],
];

const agrupar = (lista, chave) => {
  const grupos = new Map();
  for (const item of lista) {
    const k = chave(item);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(item);
  }
  return [...grupos];
};

const docs = $input.all().map((i) => i.json);
return agrupar(docs, (d) => d.email).map(([email, itens]) => {
  const prazos = itens.filter((d) => d.tipo === 'PRAZO');
  const rejeitados = itens.filter((d) => d.tipo === 'REJEITADO');
  const vencidos = itens.filter((d) => d.tipo === 'VENCIDO');
  let secoes = '';

  for (const [marco, texto, cor] of MARCOS) {
    const doMarco = prazos.filter((d) => Number(d.marco) === marco);
    if (!doMarco.length) continue;
    secoes += titulo(texto, doMarco.length, cor)
      + tabela(['Documento', 'De quem', 'Unidade', 'Competência', 'Prazo', 'Faltam', 'Motivo', 'Quem resolve', 'Portal'],
        doMarco.map((d) => [d.nome, deQuem(d), d.unidade, d.competencia, dataBr(d.prazo), diasTexto(d.dias), d.motivo, quemTexto(d.quem), d.portal]));
  }
  if (rejeitados.length) {
    secoes += titulo('Enviados e reprovados no portal', rejeitados.length, '#b42318')
      + tabela(['Documento', 'De quem', 'Unidade', 'Competência', 'Enviado em', 'Situação', 'Motivo da reprovação'],
        rejeitados.map((d) => [d.nome, deQuem(d), d.unidade, d.competencia, dataBr(d.enviado_em), d.situacao, d.motivo]));
  }
  if (vencidos.length) {
    secoes += titulo('Vencidos e não enviados', vencidos.length, '#b42318')
      + tabela(['Documento', 'De quem', 'Unidade', 'Competência', 'Prazo', 'Atraso', 'Motivo', 'Quem resolve', 'Portal'],
        vencidos.map((d) => [d.nome, deQuem(d), d.unidade, d.competencia, dataBr(d.prazo), diasTexto(d.dias), d.motivo, quemTexto(d.quem), d.portal]));
  }

  const partes = [];
  if (prazos.length) partes.push(prazos.length + ' a vencer');
  if (rejeitados.length) partes.push(rejeitados.length + (rejeitados.length === 1 ? ' reprovado' : ' reprovados'));
  if (vencidos.length) partes.push(vencidos.length + (vencidos.length === 1 ? ' vencido' : ' vencidos'));
  const urgente = vencidos.length || prazos.some((d) => Number(d.marco) <= 1) ? 'URGENTE: ' : '';

  return { json: {
    email,
    assunto: '🚨 Alertas ODA - ' + urgente + partes.join(', ') + ' - Equatorial',
    html: '<div style="font-family:Arial,sans-serif;color:#222"><p>Documentos sob sua responsabilidade que precisam de atenção.</p>' + secoes + '</div>',
    chaves: itens.map((d) => d.id + ':' + d.tipo + ':' + (d.marco ?? '')).join('|'),
  } };
});`
    },
    position: [528, 0]
  },
  output: [{ email: 'responsavel@exemplo.com', assunto: '🚨 Alertas ODA - URGENTE: 1 vencido - Equatorial', html: '<p>...</p>', chaves: '1:VENCIDO:-1' }]
});

const enviarEmail = node({
  type: 'n8n-nodes-base.gmail',
  version: 2.2,
  config: {
    name: 'Enviar e-mail ao responsável',
    parameters: {
      resource: 'message',
      operation: 'send',
      sendTo: expr('{{ $json.email }}'),
      subject: expr('{{ $json.assunto }}'),
      emailType: 'html',
      message: expr('{{ $json.html }}'),
      options: { appendAttribution: false, ccList: 'evilasio.dev@gmail.com, maceiofocus@gmail.com, augusto.leaun@gmail.com' }
    },
    credentials: { gmailOAuth2: newCredential('Gmail') },
    position: [784, 0]
  },
  output: [{ id: 'abc', threadId: 'abc' }]
});

const registrarAvisos = node({
  type: 'n8n-nodes-base.postgres',
  version: 2.6,
  config: {
    name: 'Registrar aviso enviado',
    parameters: {
      operation: 'executeQuery',
      query: "INSERT INTO alerta (tipo_alerta, severidade, documento_id, descricao, data_prevista_evento, dias_antecedencia_acionado, consumido)\nSELECT CASE p.tipo WHEN 'PRAZO' THEN 'PRAZO_VENCIMENTO' WHEN 'VENCIDO' THEN 'DOCUMENTO_VENCIDO' ELSE 'DOCUMENTO_REJEITADO' END,\n       CASE WHEN p.tipo IN ('REJEITADO', 'VENCIDO') OR p.marco <= 1 THEN 'alta' WHEN p.marco = 3 THEN 'media' ELSE 'baixa' END,\n       d.id,\n       CASE p.tipo WHEN 'PRAZO' THEN 'Aviso de vencimento (' || p.marco || 'd) enviado por e-mail'\n                   WHEN 'VENCIDO' THEN 'Aviso de documento vencido e não enviado, enviado por e-mail'\n                   ELSE 'Reprovação avisada por e-mail. Motivo: ' || left(COALESCE(d.motivo_reprovacao, 'não informado'), 900) END,\n       CASE WHEN p.tipo IN ('PRAZO', 'VENCIDO') THEN d.prazo_envio END,\n       p.marco,\n       true\n  FROM (SELECT split_part(x, ':', 1)::int AS id, split_part(x, ':', 2) AS tipo, nullif(split_part(x, ':', 3), '')::int AS marco\n          FROM unnest(string_to_array($1, '|')) AS x) p\n  JOIN documentos d ON d.id = p.id",
      options: {
        queryBatching: 'independently',
        queryReplacement: expr("{{ $('Montar um e-mail por responsável').item.json.chaves }}")
      }
    },
    credentials: { postgres: newCredential('Neon GesDoc') },
    position: [1040, 0]
  },
  output: [{}]
});

export default workflow('VyMevTW3eJwG46PC', 'Alertas EQT')
  .add(agendamento)
  .to(buscarAlertas)
  .to(montarEmails)
  .to(enviarEmail)
  .to(registrarAvisos);
