-- 004 — Catálogo e view aceitam o vocabulário que o robô publicou em 10/11
--
-- O robô grava situacao_portal ENTREGUE (status Valid) e AGUARDANDO_PREDECESSORES, e motivos/responsáveis em
-- minúsculas com nomes próprios (segurado, definicao_pendente, reprovado_portal...). Sem isto, a view jogava
-- 339 entregues no grupo Ação e marcava os motivos como fora do catálogo.
-- Só catálogo e view: nenhum dado de documentos muda.

BEGIN;

INSERT INTO situacoes_portal (codigo, grupo, descricao) VALUES
  ('ENTREGUE',                 'CONCLUIDO',         'Entregue e validado (Atlas Valid), como o robô grava'),
  ('AGUARDANDO_PREDECESSORES', 'AGUARDANDO_PORTAL', 'Atlas WaitingForPredecessors, como o robô grava (= AGUARDANDO_OUTRO)');

INSERT INTO motivos (codigo, responsavel, descricao) VALUES
  ('SEGURADO',              'OPERACAO', 'Segurado no painel para conferência (= AGUARDANDO_CONFERENCIA)'),
  ('REPROVADO_PORTAL',      'OPERACAO', 'Reprovado no portal (= CORRIGIR_REPROVACAO)'),
  ('ENVIADO_AGUARDANDO',    'OPERACAO', 'Enviado pelo robô, mas o item continua aberto no portal: conferir se o envio entrou'),
  ('DEFINICAO_PENDENTE',    'CLIENTE',  'Falta uma definição de regra ou de pasta (= DUVIDA_DE_REGRA)'),
  ('FORA_DO_ESCOPO',        'CLIENTE',  'Item que o robô não atende (filial ou pasta não mapeada, tipo fora dos 36)'),
  ('PENDENCIA_INDEVIDA',    'CLIENTE',  'O portal cobra algo que não se aplica'),
  ('AGUARDANDO_ASSINATURA', 'CLIENTE',  'Documento existe sem assinatura (= ARQUIVO_INCOMPLETO)'),
  ('ERRO_MONTAGEM',         'SISTEMA',  'Falha ao unir as partes do PDF')
ON CONFLICT (codigo) DO NOTHING;

-- View: compara códigos sem diferenciar maiúsculas, usa o responsável gravado pelo robô quando houver,
-- e "dados atualizados" passa a valer para toda linha vista na última leitura (aberta ou entregue).
DROP VIEW v_solicitacoes_resumo;
DROP VIEW v_solicitacoes;
CREATE VIEW v_solicitacoes AS
WITH ultima_ok AS (
  SELECT portal, max(inicio) AS inicio FROM coletas WHERE ok GROUP BY portal
)
SELECT
  d.id, d.portal, d.portal_item_id, d.doc_id, d.nome AS documento, d.cliente, d.unidade, d.competencia, d.prazo_envio,
  upper(d.situacao_portal)     AS situacao_portal,
  COALESCE(sp.grupo, 'ACAO')   AS grupo,
  d.status_portal, d.situacao AS situacao_texto, d.motivo_reprovacao, d.aberto_no_portal, d.visto_no_portal_em,
  (u.inicio IS NOT NULL AND d.visto_no_portal_em >= u.inicio) AS dados_atualizados,
  d.estado AS estado_interno,
  m.motivo,
  CASE WHEN m.motivo IS NULL THEN 'NENHUM'
       ELSE COALESCE(upper(d.responsavel), mo.responsavel, 'SISTEMA') END AS responsavel,
  mo.descricao AS motivo_descricao,
  (d.motivo IS NOT NULL) AS motivo_gravado,
  (m.motivo IS NOT NULL AND mo.codigo IS NULL) AS motivo_fora_do_catalogo,
  d.motivo_em,
  ev.em AS ultimo_evento_em, ev.robo AS ultimo_evento_robo, ev.tipo AS ultimo_evento_tipo,
  ev.resultado AS ultimo_evento_resultado, ev.detalhe AS ultimo_evento_detalhe,
  (d.prazo_envio - current_date) AS dias_para_prazo,
  (current_date - COALESCE(d.motivo_em, d.atualizado_em)::date) AS dias_parado
FROM documentos d
LEFT JOIN situacoes_portal sp ON sp.codigo = upper(d.situacao_portal)
LEFT JOIN documento_regras r  ON r.doc_id = d.doc_id AND r.ativo
LEFT JOIN buscas_cobertura bc ON bc.doc_id = d.doc_id
LEFT JOIN ultima_ok u         ON u.portal = d.portal
LEFT JOIN LATERAL (
  SELECT e.em, e.robo, e.tipo, e.resultado, e.detalhe
    FROM documento_eventos e WHERE e.documento_id = d.id ORDER BY e.em DESC, e.id DESC LIMIT 1
) ev ON true
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN COALESCE(sp.grupo, 'ACAO') <> 'ACAO' THEN NULL
    WHEN d.motivo IS NOT NULL THEN upper(d.motivo)
    WHEN upper(d.situacao_portal) = 'REPROVADO' OR d.estado = 'REJEITADO' THEN 'CORRIGIR_REPROVACAO'
    WHEN d.estado = 'ENVIADO'                  THEN 'ENVIADO'
    WHEN bc.quem = 'outro_meio'                THEN 'ENVIO_POR_OUTRO_MEIO'
    WHEN d.estado = 'NAO_ENCONTRADO_FACTORIAL' THEN 'FALTA_ARQUIVO'
    WHEN d.estado = 'AGUARDANDO_ASSINATURA'    THEN 'ARQUIVO_INCOMPLETO'
    WHEN d.estado = 'DIVERGENTE_FACTORIAL'     THEN 'COLABORADOR_ATIVO'
    WHEN d.estado = 'ERRO_COMPOSICAO'          THEN 'ARQUIVO_INVALIDO'
    WHEN d.estado IN ('LOCALIZADO', 'COMPOSTO') THEN 'AGUARDANDO_CONFERENCIA'
    WHEN r.doc_id IS NULL                      THEN 'SEM_REGRA'
    WHEN bc.doc_id IS NULL                     THEN 'SEM_BUSCA'
    ELSE 'NAO_BUSCADO'
  END AS motivo
) m
LEFT JOIN motivos mo ON mo.codigo = m.motivo;

CREATE VIEW v_solicitacoes_resumo AS
SELECT portal, grupo, situacao_portal, responsavel, motivo, dados_atualizados, count(*) AS quantidade
  FROM v_solicitacoes
 GROUP BY portal, grupo, situacao_portal, responsavel, motivo, dados_atualizados;

GRANT SELECT ON v_solicitacoes, v_solicitacoes_resumo TO painel_leitura, robo_atlas, sinc_factorial;

COMMIT;
