-- ============================================================================
-- MACRO 3 — TICKET 3.3: Seed de regra_documento (36 documentos Equatorial)
-- ============================================================================
-- Responsável: Luana
-- Horas estimadas: 6h
-- Data: 24/08/2026
-- ============================================================================

-- Desabilita constraint temporariamente (rebuild de índices)
SET CONSTRAINTS ALL DEFERRED;

-- Limpa dados anteriores (se houver)
DELETE FROM regra_documento WHERE indice_origem >= 2;

-- Insere os 36 documentos

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (2, 'Vale Alimentação (RelBen + Bol + CP)', 'Benefícios', 'sharepoint', TRUE, FALSE, 'empresa', 'pacote', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (3, 'Vale Transporte (RelBen + Bol + CP)', 'Benefícios', 'sharepoint', TRUE, FALSE, 'empresa', 'pacote', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (4, 'Seguro de Vida (RelBen + Bol + CP)', 'Benefícios', 'sharepoint', TRUE, FALSE, 'empresa', 'pacote', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (5, 'Plano Odontológico (RelBen + Bol + CP)', 'Benefícios', 'sharepoint', TRUE, FALSE, 'empresa', 'pacote', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (6, 'Vale Refeição (RelBen + Bol + CP)', 'Benefícios', 'sharepoint', TRUE, FALSE, 'empresa', 'pacote', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (7, 'Plano de Saúde (RelBen + Bol + CP)', 'Benefícios', 'sharepoint', TRUE, FALSE, 'empresa', 'pacote', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (8, 'Aviso de Férias + Recibo + CP Férias', 'Férias', 'factorial', TRUE, FALSE, 'colaborador', 'pacote', 'por evento (férias)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (9, 'TCRT + CP', 'Rescisório', 'factorial', TRUE, FALSE, 'colaborador', 'pacote', 'por evento (rescisão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (10, 'GFD Recisória + CP GFD Recisória', 'Rescisório/FGTS', 'factorial', TRUE, FALSE, 'colaborador', 'pacote', 'por evento (rescisão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (24, 'GFD - Guia do FGTS Digital', 'FGTS', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (venc. dia 20)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (25, 'RE - Relação de Empregados', 'FGTS', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (26, 'Comprovante de Pagto - FGTS', 'FGTS', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (56, 'Comprovante de Pagamento - Folha', 'Folha/Pagamento', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (até 5º dia útil)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (59, 'Comprovante de Recolhimento', 'INSS/FGTS', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (60, 'Recibo de Entrega DCTFWeb', 'INSS/DCTFWeb', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (61, 'Relatório Declaração Completa DCTFWeb', 'INSS/DCTFWeb', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (63, 'EXTRATO MENSAL - Folha', 'Folha/Pagamento', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade, validade_dias)
VALUES (64, 'Certidão de Regularidade do FGTS (CRF)', 'Certidões', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (validade mensal)', TRUE, 30);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (65, 'DARF', 'INSS/DCTFWeb', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (venc. dia 20)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (66, 'Relatório Mensal de Ocorrências', 'Gestão/Movimentações', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (até dia 10)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (67, 'ASO Demissional', 'Saúde/Offboarding', 'factorial', TRUE, FALSE, 'colaborador', 'simples', 'por evento (demissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (68, 'Baixa na CTPS e/ou e-Social', 'Rescisório/e-Social', 'factorial', TRUE, FALSE, 'colaborador', 'simples', 'por evento (demissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (69, 'Pedido de Demissão / Carta de Desligamento', 'Rescisório/Offboarding', 'factorial', TRUE, FALSE, 'colaborador', 'simples', 'por evento (demissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (78, 'ASO Admissional/Periódico', 'Saúde/HSEQ', 'factorial', TRUE, TRUE, 'colaborador', 'simples', 'admissional: na admissão · periódico: anual/PCMSO', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (79, 'Ficha de Registro', 'Admissão', 'factorial', TRUE, TRUE, 'colaborador', 'simples', 'por evento (admissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (80, 'Comprovante de Registro e-Social', 'Admissão/e-Social', 'factorial', TRUE, FALSE, 'colaborador', 'simples', 'por evento (admissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade, validade_dias)
VALUES (81, 'CND Federal', 'Certidões', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (validade 6 meses)', TRUE, 180);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade, validade_dias)
VALUES (82, 'CNDT', 'Certidões', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'mensal (validade 6 meses)', TRUE, 180);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (83, 'Cartão de Ponto (exportação)', 'Ponto/Jornada', 'factorial', TRUE, FALSE, 'empresa', 'simples', 'mensal', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade, validade_dias)
VALUES (84, 'AC ou CC ou AIT', 'Legal/Trabalhista', 'sharepoint', TRUE, FALSE, 'empresa', 'simples', 'anual ou quando vencer', TRUE, 365);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (95, 'Ficha de Controle de Entrega de EPI', 'HSEQ', 'factorial', FALSE, TRUE, 'colaborador', 'simples', 'por evento / anual mínimo', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (112, 'Certificado de Direção Defensiva', 'Certificados/Veículos', 'factorial', FALSE, TRUE, 'colaborador', 'simples', 'por evento (admissão/renovação)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (113, 'Certificado de Qualificação Profissional', 'Certificados', 'factorial', FALSE, TRUE, 'colaborador', 'simples', 'por evento (admissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (114, 'Certificado de Treinamento de Integração', 'Certificados/HSEQ', 'factorial', FALSE, TRUE, 'colaborador', 'simples', 'por evento (admissão)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (115, 'Certificado de Treinamento de Primeiros Socorros', 'Certificados/HSEQ', 'factorial', FALSE, TRUE, 'colaborador', 'simples', 'por evento (admissão/renovação)', FALSE);

INSERT INTO regra_documento (indice_origem, nome, categoria, origem, destino_atlas, destino_bernhoeft, tipo_entidade, grupo, periodicidade, tem_validade)
VALUES (116, 'Treinamentos internos', 'Certificados/HSEQ', 'factorial', FALSE, TRUE, 'colaborador', 'simples', 'por evento', FALSE);

-- Reabilita constraints
SET CONSTRAINTS ALL IMMEDIATE;

-- Verifica inserção
SELECT COUNT(*) as total_documentos, COUNT(DISTINCT indice_origem) as indices_unicos FROM regra_documento;

-- Listar todos os 36
SELECT indice_origem, nome, grupo, tipo_entidade, destino_atlas, destino_bernhoeft, tem_validade FROM regra_documento ORDER BY indice_origem;
