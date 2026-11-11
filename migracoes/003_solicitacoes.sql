-- 003 — Visão única das solicitações (item A da especificação "Rastreio das Solicitações GesDoc")
--
-- 1. situacoes_portal: "aberta" vira "grupo" (ACAO, AGUARDANDO_PORTAL, CONCLUIDO). As entregues em análise e
--    aguardando predecessores deixam de contar como pendência.
-- 2. buscas_cobertura: qual robô busca cada tipo de documento (para separar "ainda não buscado" de "ninguém busca").
-- 3. v_solicitacoes: uma linha por solicitação, com grupo, motivo e responsável. Enquanto os robôs não gravam
--    o motivo (item B, passo 3), ele é deduzido do estado atual (motivo_gravado = false).
-- 4. v_solicitacoes_resumo: os totais. É a única fonte de número para tela, relatório e alerta.
-- 5. v_coletas_saude: última leitura de cada portal e se os dados estão atualizados (até 2 h).
--
-- Só cria e lê: nenhum dado de documentos muda.

BEGIN;

-- 1 ─────────────────────────────────────────────── grupo no catálogo
ALTER TABLE situacoes_portal ADD COLUMN grupo varchar CHECK (grupo IN ('ACAO', 'AGUARDANDO_PORTAL', 'CONCLUIDO'));
UPDATE situacoes_portal SET grupo = CASE
    WHEN codigo IN ('EM_ANALISE', 'AGUARDANDO_OUTRO') THEN 'AGUARDANDO_PORTAL'
    WHEN codigo IN ('CONCLUIDO', 'FORA_DO_PORTAL') THEN 'CONCLUIDO'
    ELSE 'ACAO' END;
ALTER TABLE situacoes_portal ALTER COLUMN grupo SET NOT NULL, DROP COLUMN aberta;
UPDATE situacoes_portal SET descricao = 'Entregue, em análise no portal (Atlas Analysis, WaitingAnalysis, WaitingValidation, Pending; Bernhoeft Não Analisado)' WHERE codigo = 'EM_ANALISE';
UPDATE situacoes_portal SET descricao = 'Entregue, aguardando outro documento ser aprovado (Atlas WaitingForPredecessors)' WHERE codigo = 'AGUARDANDO_OUTRO';
UPDATE situacoes_portal SET descricao = 'Entregue e aprovado (Atlas Approved, Validated; Bernhoeft Conforme)' WHERE codigo = 'CONCLUIDO';

-- 2 ─────────────────────────────────────────────── quem busca cada tipo
-- Editar aqui quando um robô passar a buscar (ou deixar de buscar) um tipo. Tipo sem linha = SEM_BUSCA.
CREATE TABLE buscas_cobertura (
  doc_id     integer PRIMARY KEY REFERENCES documento_regras(doc_id) ON DELETE RESTRICT,
  quem       varchar NOT NULL,   -- sincronizacao | robo_atlas_factorial | robo_atlas_sharepoint | robo_atlas_declaracao | robo_bernhoeft | outro_meio
  observacao text
);
INSERT INTO buscas_cobertura (doc_id, quem, observacao) VALUES
  (9,  'sincronizacao', 'TRCT + comprovante'),
  (10, 'sincronizacao', 'GFD rescisória + comprovante'),
  (8,  'robo_atlas_factorial', 'passou ao robô Atlas em 09/11'),
  (67, 'robo_atlas_factorial', NULL), (68, 'robo_atlas_factorial', NULL), (69, 'robo_atlas_factorial', NULL),
  (78, 'robo_atlas_factorial', NULL), (79, 'robo_atlas_factorial', NULL), (80, 'robo_atlas_factorial', NULL),
  (83, 'robo_atlas_factorial', 'o Atlas pede por unidade; a busca por CPF não acha'),
  (2,  'robo_atlas_sharepoint', 'benefício: une relação, boleto e comprovante'),
  (3,  'robo_atlas_sharepoint', 'benefício'), (4, 'robo_atlas_sharepoint', 'benefício'), (7, 'robo_atlas_sharepoint', 'benefício'),
  (24, 'robo_atlas_sharepoint', NULL), (25, 'robo_atlas_sharepoint', NULL), (26, 'robo_atlas_sharepoint', NULL),
  (56, 'robo_atlas_sharepoint', NULL), (60, 'robo_atlas_sharepoint', NULL), (61, 'robo_atlas_sharepoint', NULL),
  (64, 'robo_atlas_sharepoint', NULL), (65, 'robo_atlas_sharepoint', NULL), (81, 'robo_atlas_sharepoint', NULL),
  (6,  'robo_atlas_declaracao', 'VR: declaração (declaracao-vr.js)'),
  (59, 'outro_meio', 'já sobe por outro processo (Milena)'),
  (63, 'outro_meio', 'já sobe por outro processo (Milena)'),
  (95, 'robo_bernhoeft', NULL), (112, 'robo_bernhoeft', NULL), (113, 'robo_bernhoeft', NULL),
  (114, 'robo_bernhoeft', NULL), (115, 'robo_bernhoeft', NULL), (116, 'robo_bernhoeft', NULL);
-- Sem linha (SEM_BUSCA): 5 plano odontológico, 66 relatório de ocorrências, 82 CNDT, 84 convenção coletiva.

-- 3 ─────────────────────────────────────────────── uma linha por solicitação
CREATE VIEW v_solicitacoes AS
WITH ultima_ok AS (
  SELECT portal, max(inicio) AS inicio FROM coletas WHERE ok GROUP BY portal
)
SELECT
  d.id,
  d.portal,
  d.portal_item_id,
  d.doc_id,
  d.nome                       AS documento,
  d.cliente,
  d.unidade,
  d.competencia,
  d.prazo_envio,
  -- portal
  d.situacao_portal,
  COALESCE(sp.grupo, 'ACAO')   AS grupo,
  d.status_portal,
  d.situacao                   AS situacao_texto,
  d.motivo_reprovacao,
  d.aberto_no_portal,
  d.visto_no_portal_em,
  (d.aberto_no_portal IS TRUE AND u.inicio IS NOT NULL AND d.visto_no_portal_em >= u.inicio) AS dados_atualizados,
  -- nosso lado
  d.estado                     AS estado_interno,
  m.motivo,
  CASE WHEN m.motivo IS NULL THEN 'NENHUM' ELSE COALESCE(mo.responsavel, 'SISTEMA') END AS responsavel,
  mo.descricao                 AS motivo_descricao,
  (d.motivo IS NOT NULL)       AS motivo_gravado,
  (m.motivo IS NOT NULL AND mo.codigo IS NULL) AS motivo_fora_do_catalogo,
  d.motivo_em,
  ev.em                        AS ultimo_evento_em,
  ev.robo                      AS ultimo_evento_robo,
  ev.tipo                      AS ultimo_evento_tipo,
  ev.resultado                 AS ultimo_evento_resultado,
  ev.detalhe                   AS ultimo_evento_detalhe,
  -- tempo
  (d.prazo_envio - current_date)                                   AS dias_para_prazo,
  (current_date - COALESCE(d.motivo_em, d.atualizado_em)::date)    AS dias_parado
FROM documentos d
LEFT JOIN situacoes_portal sp ON sp.codigo = d.situacao_portal
LEFT JOIN documento_regras r  ON r.doc_id = d.doc_id AND r.ativo
LEFT JOIN buscas_cobertura bc ON bc.doc_id = d.doc_id
LEFT JOIN ultima_ok u         ON u.portal = d.portal
LEFT JOIN LATERAL (
  SELECT e.em, e.robo, e.tipo, e.resultado, e.detalhe
    FROM documento_eventos e WHERE e.documento_id = d.id ORDER BY e.em DESC, e.id DESC LIMIT 1
) ev ON true
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN COALESCE(sp.grupo, 'ACAO') <> 'ACAO' THEN NULL                       -- aguardando o portal ou concluído
    WHEN d.motivo IS NOT NULL THEN d.motivo                                    -- gravado pelo robô
    -- deduzido do estado atual, até os robôs gravarem o motivo
    WHEN d.situacao_portal = 'REPROVADO' OR d.estado = 'REJEITADO' THEN 'CORRIGIR_REPROVACAO'
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

-- 4 ─────────────────────────────────────────────── totais
CREATE VIEW v_solicitacoes_resumo AS
SELECT portal, grupo, situacao_portal, responsavel, motivo, dados_atualizados, count(*) AS quantidade
  FROM v_solicitacoes
 GROUP BY portal, grupo, situacao_portal, responsavel, motivo, dados_atualizados;

-- 5 ─────────────────────────────────────────────── saúde das leituras
CREATE VIEW v_coletas_saude AS
SELECT p.portal,
       (SELECT max(c.inicio) FROM coletas c WHERE c.portal = p.portal)            AS ultima_leitura,
       (SELECT max(c.fim)    FROM coletas c WHERE c.portal = p.portal AND c.ok)    AS ultima_leitura_ok,
       (SELECT c.erro FROM coletas c WHERE c.portal = p.portal ORDER BY c.inicio DESC LIMIT 1) AS ultimo_erro,
       round(extract(epoch FROM now() - (SELECT max(c.fim) FROM coletas c WHERE c.portal = p.portal AND c.ok)) / 60) AS minutos_desde_ok,
       COALESCE(now() - (SELECT max(c.fim) FROM coletas c WHERE c.portal = p.portal AND c.ok) > interval '2 hours', true) AS desatualizado
  FROM (VALUES ('Atlas'), ('Bernhoeft')) AS p(portal);

-- 6 ─────────────────────────────────────────────── permissões (só leitura)
GRANT SELECT ON v_solicitacoes, v_solicitacoes_resumo, v_coletas_saude, buscas_cobertura TO painel_leitura, robo_atlas, sinc_factorial;

COMMIT;
