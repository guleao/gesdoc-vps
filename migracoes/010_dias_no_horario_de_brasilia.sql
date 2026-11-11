-- 010 — "Dias para o prazo" e "dias parado" contados pela data de Brasília
-- Aplicada em produção em 10/11/2026.
--
-- O servidor do Neon roda em UTC: depois das 21h de Brasília, CURRENT_DATE já é o dia seguinte e o painel
-- contava um dia a menos até o prazo. A view passa a usar a data de America/Sao_Paulo.

DO $$
DECLARE def text := pg_get_viewdef('v_solicitacoes'::regclass);
BEGIN
  IF position('CURRENT_DATE' in def) = 0 THEN
    RAISE EXCEPTION 'CURRENT_DATE não encontrado na v_solicitacoes';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW v_solicitacoes AS '
       || replace(def, 'CURRENT_DATE', '((now() AT TIME ZONE ''America/Sao_Paulo''::text))::date');
END $$;
