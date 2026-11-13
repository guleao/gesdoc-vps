-- Responsáveis por tipo de documento, usados pelo workflow "Alertas EQT" do n8n (documento_regras.email_responsavel).
-- Aplicado em produção em 12/11/2026, a partir da planilha de responsáveis da NIP.
--
-- Tipos sem responsável com e-mail (Adm do Projeto, Colaborador, Giovanna e os que não estavam na planilha)
-- ficam com alertasodanip@gmail.com. Coluna criada em migracoes/001b_email_responsavel.sql.

BEGIN;

UPDATE documento_regras SET email_responsavel = 'alertasodanip@gmail.com';

UPDATE documento_regras SET email_responsavel = 'gabriela.matias@nipdobrasil.com.br'
 WHERE doc_id IN (24, 25, 60, 61, 63, 64, 65, 81, 82, 84);   -- GFD, RE, DCTFWeb (recibo e relatório), extrato da folha, CRF, DARF, CND Federal, CNDT, AC/CC/AIT

UPDATE documento_regras SET email_responsavel = 'lorena.cruz@nipdobrasil.com.br'
 WHERE doc_id IN (26, 56, 59);                                -- comprovante do FGTS, comprovante de pagamento da folha, comprovante de recolhimento

UPDATE documento_regras SET email_responsavel = 'tatiana.carvalho@nipdobrasil.com.br'
 WHERE doc_id IN (68, 69);                                    -- baixa na CTPS e e-Social, pedido de demissão

UPDATE documento_regras SET email_responsavel = 'marcela.seidel@nipdobrasil.com.br'
 WHERE doc_id = 80;                                           -- comprovante de registro e-Social

UPDATE documento_regras SET email_responsavel = 'joana.novais@nipdobrasil.com.br'
 WHERE doc_id = 83;                                           -- cartão de ponto

UPDATE documento_regras SET email_responsavel = 'milena.vargas@nipdobrasil.com.br'
 WHERE doc_id = 66;                                           -- relatório mensal de ocorrências

COMMIT;
