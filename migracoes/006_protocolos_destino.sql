-- 006 — O robô liga cada protocolo ao destino da pendência
-- Aplicada em produção em 10/11/2026.
--
-- Para gravar documento_protocolos.destino_id, o robô (role robo_atlas) precisa ler documento_destinos.

GRANT SELECT ON documento_destinos TO robo_atlas;
