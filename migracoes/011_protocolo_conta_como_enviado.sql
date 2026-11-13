-- 011 — Solicitação com protocolo de envio registrado conta como enviada
-- Aplicada em produção em 10/11/2026.
--
-- O Bernhoeft lê o status pelo relatório 012, que pode estar dias atrasado: um documento que o robô já enviou
-- (com linha em documento_protocolos) continuava "Não Entregue" e aparecia como pendente ("PRONTO").
-- A etapa passa a ser ENVIADO quando há protocolo, e o status AGUARDANDO_ANALISE até o portal dizer outra coisa.

DO $$
DECLARE
  def  text := pg_get_viewdef('v_solicitacoes'::regclass);
  alvo text := '((d.estado)::text = ''ENVIADO''::text) OR (upper((d.motivo)::text) = ''ENVIADO_AGUARDANDO''::text))';
BEGIN
  IF position(alvo in def) = 0 THEN
    RAISE EXCEPTION 'trecho da etapa não encontrado na v_solicitacoes';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW v_solicitacoes AS ' || replace(def, alvo,
    '((d.estado)::text = ''ENVIADO''::text) OR (upper((d.motivo)::text) = ''ENVIADO_AGUARDANDO''::text) '
    || 'OR (EXISTS (SELECT 1 FROM documento_protocolos p2 WHERE p2.documento_id = d.id)))');
END $$;

INSERT INTO motivos (codigo, responsavel, descricao) VALUES
  ('PRONTO', 'NENHUM', 'Pronto para envio: sai na próxima rodada do automático')
ON CONFLICT (codigo) DO NOTHING;
