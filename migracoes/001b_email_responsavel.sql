-- 001b — E-mail do responsável por tipo de documento
-- Aplicada em produção (br-tiny-queen) em 30/10/2026.
--
-- Usada pelo workflow "Alertas EQT" do n8n para avisar quem responde pelo documento rejeitado.
-- Aceita mais de um endereço, separados por vírgula. Vazio: o documento não é avisado até ser preenchido.

ALTER TABLE documento_regras ADD COLUMN email_responsavel varchar;

-- o workflow usa documento_destinos para saber quando a rejeição aconteceu
GRANT SELECT ON documento_destinos TO sinc_factorial;
