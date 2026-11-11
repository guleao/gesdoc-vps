-- 007 — Scripts do Augusto aplicados em produção em 10/11/2026
--   docs/sql/2026-11-10-regras-bernhoeft.sql       (repositório guleao/gesdoc-vps)
--   docs/sql/2026-11-05-tirar-plano-odontologico.sql (idem, ajustado para ON DELETE RESTRICT)
--
-- 1. Regras 201–217: documentos de empresa que o Bernhoeft pede no relatório 012. O robô Bernhoeft
--    (neon-bern.js) acha o doc_id pelo nome exato do relatório; sem estas regras ele não gravava nada.
-- 2. Doc 5 (plano odontológico) sai do sistema: a NIP não tem esse benefício.

BEGIN;

-- 1 ─────────────────────────────────────────────── regras do Bernhoeft
INSERT INTO documento_regras (doc_id, nome, categoria, origem, destino, chave, ativo) VALUES
  (201, 'EQT - Brigada de Incêndio com relação de todos os membros, certificados de treinamento, cronograma de reuniões, simulados e relatórios', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (202, 'EQT - Laudo de Isolação Elétrica de EPI e EPC utilizados em instalações elétricas energizadas', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (203, 'EQT - PCMSO (Programa de Controle Médico de Saúde Ocupacional)', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (204, 'EQT - Plano de Atendimento a Emergência - PAE', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (205, 'EQT - Plano de Emergência Contra Incêndio', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (206, 'EQT - Projeto de Prevenção e Combate Incêndio e AVCB da edificação', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (207, 'EQT - Análise Ergonômica do Trabalho (AET)', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (208, 'EQT - CIPA (Ata de Instalação e posse ou Carta de Designado com Certificação de Curso)', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (209, 'EQT - ASO (Atestado de Saúde Ocupacional)', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (210, 'EQT - Programa de Gerenciamento de Riscos - PGR', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (211, 'EQT - Laudo Insalubridade , Periculosidade ou atividades realizadas em condições especiais', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (212, 'EQT - Procedimento Operacional Padrão de todas as atividades', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (213, 'EQT - Relação com endereço de Alojamentos sob responsabilidade da empresa', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (214, 'EQT - Relação de ferramentas, máquinas, equipamentos, veículos, EPI e EPC a serem utilizados', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (215, 'EQT - Certificado de Direção Defensiva (Para todos os condutores)', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (216, 'EQT - Comprovantes de Participação de Treinamentos de Segurança do Trabalho (Ordem de Serviço [NR01] e demais NRs com conteúdo programático).', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true),
  (217, 'EQT - Comprovante de entrega e devolução de EPI''s com os respectivos CA''s (com CAs válidos)', 'Documentos de Empresa', 'Pacotes NIP', 'Bernhoeft', 'Contrato', true)
ON CONFLICT (doc_id) DO NOTHING;

INSERT INTO documento_regra_destinos (doc_id, destino)
  SELECT doc_id, 'Bernhoeft' FROM documento_regras WHERE doc_id BETWEEN 201 AND 217
ON CONFLICT (doc_id, destino) DO NOTHING;

INSERT INTO buscas_cobertura (doc_id, quem, observacao)
  SELECT doc_id, 'robo_bernhoeft', 'documento de empresa: esteira monta a partir dos pacotes da NIP'
    FROM documento_regras WHERE doc_id BETWEEN 201 AND 217
ON CONFLICT (doc_id) DO NOTHING;

-- 2 ─────────────────────────────────────────────── doc 5 sai (as tabelas de evidência são RESTRICT: filhos primeiro)
DELETE FROM documento_eventos  WHERE documento_id IN (SELECT id FROM documentos WHERE doc_id = 5);
DELETE FROM documento_destinos WHERE documento_id IN (SELECT id FROM documentos WHERE doc_id = 5);
DELETE FROM documento_regra_destinos WHERE doc_id = 5;
DELETE FROM documentos       WHERE doc_id = 5;
DELETE FROM documento_regras WHERE doc_id = 5;

COMMIT;
