-- Passo 4 (10/11): regras dos 17 documentos de EMPRESA que o Bernhoeft pede no relatório 012, para o robô Bernhoeft gravar
-- essas pendências na tabela documentos (portal = 'Bernhoeft'). O nome é EXATAMENTE a descrição do 012: é por ele que o
-- robô (bernhoeft-robo/neon-bern.js) acha o doc_id. Documento novo no 012 sem regra aqui = pulado e listado no log do robô.
-- origem 'Pacotes NIP' = a esteira do painel monta o PDF a partir dos pacotes da NIP (não é Factorial nem SharePoint).
-- Rodar no SQL Editor do Neon como neondb_owner (robo_atlas não pode criar regra). Pode rodar de novo (ON CONFLICT).

BEGIN;

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

COMMIT;

-- Conferir: deve dar 17
-- SELECT count(*) FROM documento_regras WHERE doc_id BETWEEN 201 AND 217 AND destino = 'Bernhoeft';
