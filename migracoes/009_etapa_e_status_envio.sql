-- 009 — Pendentes × enviados, status do envio e quem enviou
--
-- O painel passa a contar: pendentes (atrasados ou no prazo, que o sistema vai tentar enviar), enviados e o status
-- dos enviados (aprovado, aguardando análise, reprovado).
-- - Reprovado no portal é responsabilidade do CLIENTE (precisa mandar o documento correto).
-- - O que o robô enviou conta como enviado, mesmo que o item continue aberto no portal (aguardando análise).
-- Aplicada em produção em 10/11/2026.
-- Novas colunas na v_solicitacoes: etapa (PENDENTE, ENVIADO, FORA), status_envio, quem_enviou.

BEGIN;

UPDATE motivos SET responsavel = 'CLIENTE', descricao = 'Reprovado no portal: o cliente precisa mandar o documento correto'
 WHERE codigo IN ('REPROVADO_PORTAL', 'CORRIGIR_REPROVACAO');
UPDATE motivos SET responsavel = 'NENHUM', descricao = 'Enviado pelo robô; o portal ainda não confirmou a entrega'
 WHERE codigo = 'ENVIADO_AGUARDANDO';

INSERT INTO motivos (codigo, responsavel, descricao) VALUES
  ('CONFIANCA_BAIXA', 'OPERACAO', 'Arquivo achado com confiança baixa: conferir o PDF antes de enviar'),
  ('SEM_ROBO',        'SISTEMA',  'Nenhum robô busca este tipo de documento')
ON CONFLICT (codigo) DO NOTHING;

DROP VIEW v_solicitacoes_resumo;
DROP VIEW v_solicitacoes;

CREATE VIEW v_solicitacoes AS
WITH ultima_ok AS (
  SELECT portal, max(inicio) AS inicio FROM coletas WHERE ok GROUP BY portal
)
SELECT
  d.id, d.portal, d.portal_item_id, d.doc_id, d.nome AS documento, d.cliente, d.unidade, d.competencia, d.prazo_envio,
  c.sit AS situacao_portal,
  COALESCE(sp.grupo, 'ACAO') AS grupo,
  d.status_portal, d.situacao AS situacao_texto, d.motivo_reprovacao, d.aberto_no_portal, d.visto_no_portal_em,
  (u.inicio IS NOT NULL AND d.visto_no_portal_em >= u.inicio) AS dados_atualizados,
  d.estado AS estado_interno,
  m.motivo,
  (CASE
     WHEN c.etapa = 'ENVIADO' AND c.status_envio = 'REPROVADO' THEN 'CLIENTE'
     WHEN c.etapa <> 'PENDENTE' THEN 'NENHUM'
     WHEN m.motivo IS NULL THEN 'NENHUM'
     ELSE COALESCE(mo.responsavel, upper(d.responsavel), 'SISTEMA')
   END)::text AS responsavel,
  mo.descricao AS motivo_descricao,
  (d.motivo IS NOT NULL) AS motivo_gravado,
  (m.motivo IS NOT NULL AND mo.codigo IS NULL) AS motivo_fora_do_catalogo,
  d.motivo_em,
  ev.em AS ultimo_evento_em, ev.robo AS ultimo_evento_robo, ev.tipo AS ultimo_evento_tipo,
  ev.resultado AS ultimo_evento_resultado, ev.detalhe AS ultimo_evento_detalhe,
  (d.prazo_envio - current_date) AS dias_para_prazo,
  (current_date - COALESCE(d.motivo_em, d.atualizado_em)::date) AS dias_parado,
  c.etapa,
  c.status_envio,
  c.quem_enviou,
  d.enviado_em
FROM documentos d
LEFT JOIN documento_regras r  ON r.doc_id = d.doc_id AND r.ativo
LEFT JOIN buscas_cobertura bc ON bc.doc_id = d.doc_id
LEFT JOIN ultima_ok u         ON u.portal = d.portal
LEFT JOIN LATERAL (
  SELECT e.em, e.robo, e.tipo, e.resultado, e.detalhe
    FROM documento_eventos e WHERE e.documento_id = d.id ORDER BY e.em DESC, e.id DESC LIMIT 1
) ev ON true
CROSS JOIN LATERAL (
  SELECT x.sit, x.etapa,
         CASE WHEN x.etapa <> 'ENVIADO' THEN NULL
              WHEN x.sit IN ('ENTREGUE', 'CONCLUIDO') THEN 'APROVADO'
              WHEN x.sit = 'REPROVADO' THEN 'REPROVADO'
              ELSE 'AGUARDANDO_ANALISE' END AS status_envio,
         CASE WHEN x.etapa <> 'ENVIADO' THEN NULL
              WHEN x.pelo_robo THEN 'ROBO'
              WHEN d.situacao ILIKE '%manualmente%' THEN 'EQUIPE'
              ELSE 'NAO_REGISTRADO' END AS quem_enviou
    FROM (
      SELECT upper(d.situacao_portal) AS sit,
             (d.situacao ILIKE '%pela automação%' OR upper(d.motivo) = 'ENVIADO_AGUARDANDO'
              OR EXISTS (SELECT 1 FROM documento_protocolos p WHERE p.documento_id = d.id)) AS pelo_robo,
             CASE
               WHEN upper(d.situacao_portal) = 'FORA_DO_PORTAL' THEN 'FORA'
               WHEN upper(d.situacao_portal) IN ('ENTREGUE', 'CONCLUIDO', 'EM_ANALISE', 'AGUARDANDO_PREDECESSORES', 'AGUARDANDO_OUTRO', 'REPROVADO') THEN 'ENVIADO'
               WHEN d.estado = 'ENVIADO' OR upper(d.motivo) = 'ENVIADO_AGUARDANDO' THEN 'ENVIADO'
               ELSE 'PENDENTE'
             END AS etapa
    ) x
) c
LEFT JOIN situacoes_portal sp ON sp.codigo = c.sit
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN c.etapa <> 'PENDENTE' AND upper(COALESCE(d.motivo, '')) <> 'ENVIADO_AGUARDANDO' AND COALESCE(c.status_envio, '') <> 'REPROVADO' THEN NULL
    WHEN c.status_envio = 'REPROVADO' THEN 'REPROVADO_PORTAL'
    WHEN d.motivo IS NOT NULL THEN upper(d.motivo)
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
SELECT portal, etapa, status_envio, quem_enviou, grupo, situacao_portal, responsavel, motivo, dados_atualizados, count(*) AS quantidade
  FROM v_solicitacoes
 GROUP BY portal, etapa, status_envio, quem_enviou, grupo, situacao_portal, responsavel, motivo, dados_atualizados;

GRANT SELECT ON v_solicitacoes, v_solicitacoes_resumo TO painel_leitura, robo_atlas, sinc_factorial;

COMMIT;
