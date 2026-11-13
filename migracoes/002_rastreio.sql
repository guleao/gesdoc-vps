-- 002 — Rastreio das solicitações (especificação "Rastreio das Solicitações GesDoc", passo 1)
--
-- Só acrescenta: colunas novas em documentos (vazias, aceitam nulo), tabelas novas e permissões.
-- Nada que os robôs fazem hoje muda. Quem passa a preencher:
--   robô de leitura  -> portal, portal_item_id, status_portal, situacao_portal, motivo_reprovacao,
--                       aberto_no_portal, visto_no_portal_em; uma linha em coletas por leitura
--   robô de envio    -> motivo, responsavel, motivo_em; uma linha em documento_eventos por ação;
--                       documento_protocolos em cada envio
--   sincronização    -> motivo, responsavel, motivo_em; documento_eventos
--
-- Os códigos válidos ficam nas tabelas de referência situacoes_portal e motivos (sem chave estrangeira:
-- um código novo não derruba o robô; a view marca o que não estiver no catálogo).

BEGIN;

-- 1 ─────────────────────────────────────────────── catálogos
CREATE TABLE situacoes_portal (
  codigo    varchar PRIMARY KEY,
  aberta    boolean NOT NULL,
  descricao text NOT NULL
);
INSERT INTO situacoes_portal (codigo, aberta, descricao) VALUES
  ('NO_PRAZO',         true,  'Pedido no portal, prazo não vencido (Atlas PendingNotSent; Bernhoeft Não Entregue no prazo)'),
  ('ATRASADO',         true,  'Prazo vencido sem envio (Atlas DelayNotSent; Bernhoeft Não Entregue vencido)'),
  ('REPROVADO',        true,  'Portal recusou (Atlas DelayRejected, PendingRejected, Rejected; Bernhoeft Reprovado/Não Conforme)'),
  ('EM_ANALISE',       true,  'Enviado e ainda não validado (Bernhoeft Não Analisado)'),
  ('AGUARDANDO_OUTRO', true,  'Atlas WaitingForPredecessors'),
  ('CONCLUIDO',        false, 'Entregue/aprovado (Atlas lista Entregues; Bernhoeft Aprovado/Conforme)'),
  ('FORA_DO_PORTAL',   false, 'Saiu das listas e não está em Entregues'),
  ('DESCONHECIDO',     true,  'Status do portal fora deste catálogo: incluir aqui');

CREATE TABLE motivos (
  codigo      varchar PRIMARY KEY,
  responsavel varchar NOT NULL CHECK (responsavel IN ('CLIENTE', 'OPERACAO', 'SISTEMA', 'NENHUM')),
  descricao   text NOT NULL
);
INSERT INTO motivos (codigo, responsavel, descricao) VALUES
  ('FALTA_ARQUIVO',           'CLIENTE',  'O documento não está na Factorial ou no SharePoint'),
  ('ARQUIVO_INCOMPLETO',      'CLIENTE',  'Falta parte: assinatura, comprovante, relação, aviso de férias'),
  ('COLABORADOR_ATIVO',       'CLIENTE',  'O portal cobra rescisão de quem consta ativo na Factorial'),
  ('ORIGEM_NAO_INFORMADA',    'CLIENTE',  'Pasta da filial ou fonte não informada'),
  ('DUVIDA_DE_REGRA',         'CLIENTE',  'Pergunta aberta com dono (Milena, RH)'),
  ('ENVIO_POR_OUTRO_MEIO',    'CLIENTE',  'Travado de propósito: já sobe por outro processo'),
  ('AGUARDANDO_CONFERENCIA',  'OPERACAO', 'Pronto e segurado para conferência do PDF'),
  ('ACAO_NO_PORTAL',          'OPERACAO', 'Excluir arquivo reprovado (22006), aceitar termo (81005), concluir carregamento'),
  ('CORRIGIR_REPROVACAO',     'OPERACAO', 'Reprovado: ler o motivo e trocar o documento'),
  ('SEM_REGRA',               'SISTEMA',  'Tipo sem linha em documento_regras'),
  ('SEM_BUSCA',               'SISTEMA',  'Tem regra, mas nenhum robô busca este tipo'),
  ('NAO_BUSCADO',             'SISTEMA',  'Deveria ter sido buscado e não foi nas últimas 4 horas'),
  ('ERRO_BUSCA',              'SISTEMA',  'Factorial ou SharePoint falhou (401, 403, timeout)'),
  ('ARQUIVO_INVALIDO',        'SISTEMA',  'PDF corrompido, vazio ou sem permissão de leitura'),
  ('ARQUIVO_ERRADO',          'SISTEMA',  'A conferência de conteúdo recusou o arquivo escolhido'),
  ('ERRO_ENVIO',              'SISTEMA',  'Falha técnica no upload'),
  ('PRONTO_PARA_ENVIO',       'NENHUM',   'Conferido e liberado, aguardando a próxima rodada'),
  ('ENVIADO',                 'NENHUM',   'Subiu; o portal ainda vai analisar');

-- 2 ─────────────────────────────────────────────── colunas novas em documentos (todas aceitam nulo)
ALTER TABLE documentos
  ADD COLUMN portal             varchar,
  ADD COLUMN portal_item_id     varchar,
  ADD COLUMN status_portal      varchar,
  ADD COLUMN situacao_portal    varchar,
  ADD COLUMN motivo_reprovacao  text,
  ADD COLUMN aberto_no_portal   boolean,
  ADD COLUMN visto_no_portal_em timestamptz,
  ADD COLUMN motivo             varchar,
  ADD COLUMN responsavel        varchar,
  ADD COLUMN motivo_em          timestamptz;
CREATE INDEX documentos_portal_item ON documentos (portal, portal_item_id);

-- 3 ─────────────────────────────────────────────── leituras dos portais
CREATE TABLE coletas (
  id      bigserial PRIMARY KEY,
  portal  varchar NOT NULL,
  inicio  timestamptz NOT NULL DEFAULT now(),
  fim     timestamptz,
  ok      boolean,
  totais  jsonb,
  erro    text
);
CREATE INDEX coletas_portal_fim ON coletas (portal, fim DESC);

-- 4 ─────────────────────────────────────────────── o que cada robô fez em cada solicitação
CREATE TABLE documento_eventos (
  id           bigserial PRIMARY KEY,
  documento_id integer NOT NULL REFERENCES documentos(id) ON DELETE RESTRICT,
  em           timestamptz NOT NULL DEFAULT now(),
  robo         varchar NOT NULL,   -- leitura | busca | montagem | envio | painel | sincronizacao
  tipo         varchar NOT NULL,   -- BUSCA | MONTAGEM | CONFERENCIA | TRAVA | SOLTURA | ENVIO | REPROVACAO
  resultado    varchar NOT NULL,   -- OK | FALHA | PULOU | INICIADO
  motivo       varchar,            -- código de motivos
  responsavel  varchar,
  detalhe      text,               -- sem CPF, nome de colaborador ou senha
  dados        jsonb
);
CREATE INDEX documento_eventos_documento ON documento_eventos (documento_id, em DESC);

-- 5 ─────────────────────────────────────────────── preenchimento inicial (só o que o banco já sabe)
-- aberto_no_portal fica vazio: só a próxima leitura do robô sabe o que ainda está aberto.
UPDATE documentos SET portal = 'Atlas' WHERE aba IS NOT NULL AND portal IS NULL;
UPDATE documentos SET situacao_portal = CASE
    WHEN situacao ILIKE 'Reprovado%' OR situacao IN ('PendingRejected', 'DelayRejected', 'Rejected') THEN 'REPROVADO'
    WHEN situacao = 'Não enviado no prazo' THEN 'ATRASADO'
    WHEN situacao = 'A enviar' THEN 'NO_PRAZO'
    WHEN situacao ILIKE 'Enviado%' THEN 'EM_ANALISE'
    ELSE 'DESCONHECIDO' END
 WHERE portal = 'Atlas' AND situacao_portal IS NULL;

-- 6 ─────────────────────────────────────────────── permissões (nenhuma role apaga nada)
GRANT SELECT ON situacoes_portal, motivos TO robo_atlas, sinc_factorial, gesdoc_sync_perm, painel_leitura;
GRANT SELECT ON coletas, documento_eventos TO painel_leitura;

-- robô Atlas (leitura e envio)
GRANT INSERT (portal, portal_item_id, status_portal, situacao_portal, motivo_reprovacao, aberto_no_portal, visto_no_portal_em,
              motivo, responsavel, motivo_em) ON documentos TO robo_atlas;
GRANT UPDATE (portal, portal_item_id, status_portal, situacao_portal, motivo_reprovacao, aberto_no_portal, visto_no_portal_em,
              motivo, responsavel, motivo_em) ON documentos TO robo_atlas;
GRANT SELECT, INSERT, UPDATE ON coletas TO robo_atlas;
GRANT SELECT, INSERT ON documento_eventos, documento_protocolos TO robo_atlas;
GRANT USAGE ON SEQUENCE coletas_id_seq, documento_eventos_id_seq, documento_protocolos_id_seq TO robo_atlas;

-- sincronização Factorial (role em uso na VPS e o grupo do repositório)
GRANT UPDATE (motivo, responsavel, motivo_em) ON documentos TO sinc_factorial, gesdoc_sync_perm;
GRANT SELECT, INSERT ON documento_eventos TO sinc_factorial, gesdoc_sync_perm;
GRANT USAGE ON SEQUENCE documento_eventos_id_seq TO sinc_factorial, gesdoc_sync_perm;

COMMIT;
