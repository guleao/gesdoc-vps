-- 008 — numero_pedido aceita até 200 caracteres
-- Aplicada em produção e no branch de teste em 10/11/2026.
--
-- O robô Bernhoeft grava "contrato / área" em numero_pedido, e algumas áreas passam de 60 caracteres
-- (ex.: "GERÊNCIA PLANEJAMENTO E ENGENHARIA AT" chega a 62). Com 60, a gravação inteira falhava.
-- Aumentar o tamanho não reescreve a tabela nem o índice da chave natural. Cortar o texto no robô
-- poderia fazer dois contratos ou áreas diferentes virarem a mesma pendência na chave natural.

ALTER TABLE documentos ALTER COLUMN numero_pedido TYPE varchar(200);
