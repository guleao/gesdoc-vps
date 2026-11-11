-- ============================================================================
-- Populando tabela documento_regras com os 36 documentos mapeados
-- ============================================================================
-- Usando UPSERT (INSERT OR UPDATE) para evitar conflitos de duplicatas

INSERT INTO documento_regras (doc_id, nome, categoria, origem, destino, chave, ativo) VALUES
(2, 'Vale Alimentação', 'Benefícios', 'SharePoint', 'Atlas', 'CNPJ', true),
(3, 'Vale Transporte', 'Benefícios', 'SharePoint', 'Atlas', 'CNPJ', true),
(4, 'Seguro de Vida', 'Benefícios', 'SharePoint', 'Atlas', 'CNPJ', true),
(5, 'Plano Odontológico', 'Benefícios', 'SharePoint', 'Atlas', 'CNPJ', true),
(6, 'Vale Refeição', 'Benefícios', 'SharePoint', 'Atlas', 'CNPJ', true),
(7, 'Plano de Saúde', 'Benefícios', 'SharePoint', 'Atlas', 'CNPJ', true),
(8, 'Aviso de Férias', 'Férias', 'Factorial', 'Atlas', 'CPF', true),
(9, 'TCRT', 'Rescisório', 'Factorial', 'Atlas', 'CPF', true),
(10, 'GFD Rescisória', 'Rescisório/FGTS', 'Factorial', 'Atlas', 'CPF', true),
(24, 'GFD - Guia do FGTS Digital', 'FGTS', 'SharePoint', 'Atlas', 'CNPJ', true),
(25, 'RE - Relação de Empregados', 'FGTS', 'SharePoint', 'Atlas', 'CNPJ', true),
(26, 'Comprovante de Pagto - FGTS', 'FGTS', 'SharePoint', 'Atlas', 'CNPJ', true),
(56, 'Comprovante de Pagamento - Folha', 'Folha/Pagamento', 'SharePoint', 'Atlas', 'CNPJ', true),
(59, 'Comprovante de Recolhimento', 'INSS/FGTS', 'SharePoint', 'Atlas', 'CNPJ', true),
(60, 'Recibo da DCTFWeb', 'INSS/DCTFWeb', 'SharePoint', 'Atlas', 'CNPJ', true),
(61, 'Relatório da DCTFWeb', 'INSS/DCTFWeb', 'SharePoint', 'Atlas', 'CNPJ', true),
(63, 'Extrato mensal da folha', 'Folha/Pagamento', 'SharePoint', 'Atlas', 'CNPJ', true),
(64, 'CRF - Regularidade do FGTS', 'Certidões', 'SharePoint', 'Atlas', 'CNPJ', true),
(65, 'DARF', 'INSS/DCTFWeb', 'SharePoint', 'Atlas', 'CNPJ', true),
(66, 'Relatório mensal de ocorrências', 'Gestão/Movimentações', 'SharePoint', 'Atlas', 'CNPJ', true),
(67, 'ASO Demissional', 'Saúde/Offboarding', 'Factorial', 'Atlas', 'CPF', true),
(68, 'Baixa na CTPS e e-Social', 'Rescisório/e-Social', 'Factorial', 'Atlas', 'CPF', true),
(69, 'Pedido de demissão', 'Rescisório/Offboarding', 'Factorial', 'Atlas', 'CPF', true),
(78, 'ASO Admissional', 'Saúde/HSEQ', 'Factorial', 'Atlas', 'CPF', true),
(79, 'Ficha de Registro', 'Admissão', 'Factorial', 'Atlas', 'CPF', true),
(80, 'Comprovante de Registro e-Social', 'Admissão/e-Social', 'Factorial', 'Atlas', 'CPF', true),
(81, 'CND Federal', 'Certidões', 'SharePoint', 'Atlas', 'CNPJ', true),
(82, 'CNDT - Débitos trabalhistas', 'Certidões', 'SharePoint', 'Atlas', 'CNPJ', true),
(83, 'Cartão de ponto', 'Ponto/Jornada', 'Factorial', 'Atlas', 'CNPJ', true),
(84, 'AC ou CC ou AIT', 'Legal/Trabalhista', 'SharePoint', 'Atlas', 'CNPJ', true),
(95, 'Ficha de entrega de EPI', 'HSEQ', 'Factorial', 'Bernhoeft', 'CPF', true),
(112, 'Certificado de Direção Defensiva', 'Certificados/Veículos', 'Factorial', 'Bernhoeft', 'CPF', true),
(113, 'Certificado de Qualificação', 'Certificados', 'Factorial', 'Bernhoeft', 'CPF', true),
(114, 'Certificado de Integração', 'Certificados/HSEQ', 'Factorial', 'Bernhoeft', 'CPF', true),
(115, 'Certificado de Primeiros Socorros', 'Certificados/HSEQ', 'Factorial', 'Bernhoeft', 'CPF', true),
(116, 'Treinamentos internos', 'Certificados/HSEQ', 'Factorial', 'Bernhoeft', 'CPF', true)
ON CONFLICT (doc_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  categoria = EXCLUDED.categoria,
  origem = EXCLUDED.origem,
  destino = EXCLUDED.destino,
  chave = EXCLUDED.chave,
  ativo = EXCLUDED.ativo;

SELECT COUNT(*) as "Total de regras inseridas" FROM documento_regras;
