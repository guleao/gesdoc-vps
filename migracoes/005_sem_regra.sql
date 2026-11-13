-- 005 — Itens sem regra podem entrar no banco
--
-- doc_id passa a aceitar vazio: o robô de leitura grava o item do portal que não é um dos 36 documentos
-- (hoje 5 do Atlas e os do Bernhoeft), e a v_solicitacoes o mostra com o motivo SEM_REGRA.
-- A chave estrangeira para documento_regras continua valendo quando doc_id está preenchido.
-- Inclui o motivo COLABORADOR_NAO_ENCONTRADO, gravado pela sincronização Factorial.

BEGIN;

ALTER TABLE documentos ALTER COLUMN doc_id DROP NOT NULL;

INSERT INTO motivos (codigo, responsavel, descricao) VALUES
  ('COLABORADOR_NAO_ENCONTRADO', 'CLIENTE', 'O CPF pedido pelo portal não está cadastrado na Factorial')
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
