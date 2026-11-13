-- ============================================================================
-- MACRO 3 — TICKET 3.2: DDL PostgreSQL — Entidades, Tipos e Constraints
-- ============================================================================
-- Responsável: Augusto
-- Horas estimadas: 7h
-- Insumo: Seção 1 (entidades) e Seção 2 (máquina de estados) de 3.1_Estados_Entidades_Transicoes.md
-- Data: 24/08/2026
-- ============================================================================

-- ============================================================================
-- 1. ENUMS — Estados da máquina de estados
-- ============================================================================

-- Estados do documento (independente de destino)
CREATE TYPE enum_documento_estado AS ENUM (
    'AUSENTE',                      -- Documento não localizado
    'LOCALIZADO',                   -- Arquivo detectado (SharePoint/Factorial)
    'EM_VALIDACAO',                 -- Validação em andamento
    'INVALIDO',                     -- Validação falhou
    'VALIDO',                        -- Passado em validação
    'AGUARDANDO_COMPOSICAO',        -- Aguardando itens do pacote
    'ALERTA_PACOTE_INCOMPLETO',    -- Pacote com itens faltando
    'COMPOSTO',                     -- PDF merge executado (Macro 5)
    'PRONTO_PARA_ENVIO'             -- Pronto para destino_envio processar
);

-- Estados do destino_envio (por portal — Atlas ou Bernhoeft)
CREATE TYPE enum_destino_estado AS ENUM (
    'PENDENTE_ENVIO',               -- Não foi enviado ainda
    'ENVIADO',                      -- tentativa_envio registrada
    'AGUARDANDO_RETORNO',           -- Aguardando resposta do portal
    'ALERTA_SEM_RETORNO',          -- Timeout sem retorno (2h+ sem resposta)
    'APROVADO',                     -- Portal aprovou, protocolo gerado
    'REJEITADO',                    -- Portal rejeitou
    'PENDENTE_CORRECAO',            -- Rejeitado, aguardando nova versão
    'PENDENTE_INTERVENCAO'          -- Bloqueado (ex: reCAPTCHA, fila manual)
);

-- Tipo de entidade (escopo)
CREATE TYPE enum_tipo_entidade AS ENUM (
    'colaborador',                  -- CPF — pessoa física
    'empresa'                       -- CNPJ — pessoa jurídica
);

-- Tipo de origem do documento
CREATE TYPE enum_origem AS ENUM (
    'sharepoint',                   -- SharePoint da Equatorial
    'factorial'                     -- Plataforma Factorial (RH)
);

-- Tipo de resultado de envio/tentativa
CREATE TYPE enum_resultado_envio AS ENUM (
    'pendente',                     -- Aguardando processamento
    'enviado',                      -- Enviado com sucesso ao portal
    'erro_rede',                    -- Falha de conectividade
    'erro_validacao',               -- Rejeição do portal por validação
    'erro_sistema',                 -- Erro interno do sistema
    'timeout'                       -- Timeout na resposta do portal
);

-- ============================================================================
-- 2. TABELAS — Estrutura de dados
-- ============================================================================

-- ============================================================================
-- 2.1 Tabela: regra_documento
-- Representa cada tipo de documento da matriz (116 possíveis, 36 para Equatorial)
-- ============================================================================
CREATE TABLE regra_documento (
    id SERIAL PRIMARY KEY,

    -- Identificação
    indice_origem INTEGER NOT NULL,                    -- Linha original no xlsx (para rastreabilidade)
    nome VARCHAR(255) NOT NULL,                        -- Ex: "Vale Alimentação (RelBen + Bol + CP)"
    categoria VARCHAR(100) NOT NULL,                   -- Ex: "Benefícios", "FGTS", "Certidões"

    -- Origem e Destino
    origem enum_origem NOT NULL,                       -- SharePoint ou Factorial
    destino_atlas BOOLEAN NOT NULL DEFAULT TRUE,       -- Vai para Atlas?
    destino_bernhoeft BOOLEAN NOT NULL DEFAULT FALSE,  -- Vai para Bernhoeft?

    -- Classificação
    tipo_entidade enum_tipo_entidade NOT NULL,         -- colaborador (CPF) ou empresa (CNPJ)
    grupo VARCHAR(50) NOT NULL,                        -- 'simples' | 'pacote' | 'bernhoeft_only'

    -- Periodicidade
    periodicidade VARCHAR(50) NOT NULL,                -- 'mensal', 'anual', 'por evento', etc

    -- Metadados
    portal_origem_externo VARCHAR(100),                -- Ex: "CAJU", "GVBUS" (info apenas, não integração)
    tem_validade BOOLEAN NOT NULL DEFAULT FALSE,       -- Entra no calendário de alerta (Macro 5)?
    validade_dias INTEGER,                             -- Ex: 180 para 6 meses

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(indice_origem)
);

-- ============================================================================
-- 2.2 Tabela: entidade
-- Colaborador (CPF) ou Empresa (CNPJ) que é sujeito de documentos
-- ============================================================================
CREATE TABLE entidade (
    id BIGSERIAL PRIMARY KEY,

    -- Tipo
    tipo enum_tipo_entidade NOT NULL,                  -- colaborador | empresa

    -- Identificadores
    cpf_ou_cnpj VARCHAR(18) NOT NULL,                  -- Formato: "12345678901234" (sem máscara)
    nome_exibicao VARCHAR(255) NOT NULL,               -- Nome completo ou razão social

    -- Metadados de negócio
    ativo BOOLEAN NOT NULL DEFAULT TRUE,               -- Entrada em folha ativa?
    data_inicio_vinculo DATE,                          -- Quando começou (colaborador) ou criação (empresa)
    data_fim_vinculo DATE,                             -- NULL se ainda ativo; data de desligamento/encerramento

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(tipo, cpf_ou_cnpj)
);

-- ============================================================================
-- 2.3 Tabela: contrato_projeto
-- Vínculo contratual/obra para documentos que são por contrato (nem todo documento tem)
-- ============================================================================
CREATE TABLE contrato_projeto (
    id BIGSERIAL PRIMARY KEY,

    -- Identificação
    numero_contrato VARCHAR(50) NOT NULL,              -- Ex: "EQUATORIAL-2024-001"
    numero_projeto VARCHAR(50),                        -- Ex: "RRT-PGR-2024"
    descricao VARCHAR(500),                            -- Ex: "Reforma de Subestação SP-01"

    -- Datas
    data_inicio DATE NOT NULL,
    data_fim_prevista DATE,

    -- Status
    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(numero_contrato)
);

-- ============================================================================
-- 2.4 Tabela: documento
-- Instância concreta: cruzamento de regra_documento + entidade + competência/evento
-- ============================================================================
CREATE TABLE documento (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Keys
    regra_documento_id INTEGER NOT NULL REFERENCES regra_documento(id),
    entidade_id BIGINT NOT NULL REFERENCES entidade(id),
    contrato_projeto_id BIGINT REFERENCES contrato_projeto(id),  -- NULL se não é por obra

    -- Período/Evento
    competencia_ou_evento DATE NOT NULL,               -- Ex: "2024-08" (mensal) ou "2024-01-15" (evento)

    -- Estado
    estado enum_documento_estado NOT NULL DEFAULT 'AUSENTE',

    -- Composição (para documentos tipo 'pacote')
    total_itens_esperados INTEGER,                      -- Número de arquivos esperados no pacote

    -- Chave de negócio composta (idempotência)
    -- UNIQUE (regra_documento_id, entidade_id, competencia_ou_evento, contrato_projeto_id)
    -- será criada via constraint abaixo

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(regra_documento_id, entidade_id, competencia_ou_evento, contrato_projeto_id)
);

-- ============================================================================
-- 2.5 Tabela: versao_documento
-- Cada arquivo que chega para um documento (original, correção, reenvio)
-- ============================================================================
CREATE TABLE versao_documento (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Key
    documento_id BIGINT NOT NULL REFERENCES documento(id) ON DELETE CASCADE,

    -- Conteúdo
    hash_sha256 VARCHAR(64) NOT NULL,                  -- Hex string do hash (idempotência)
    tamanho_bytes BIGINT NOT NULL,

    -- Origem
    origem enum_origem NOT NULL,
    caminho_arquivo VARCHAR(500),                      -- Ex: "/equatorial/documentos/ASO_12345.pdf"

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(documento_id, hash_sha256)                  -- Mesma versão (hash) só uma vez por documento
);

-- ============================================================================
-- 2.6 Tabela: pacote
-- Agrupamento de itens "+" que precisam ser mesclados antes do envio
-- ============================================================================
CREATE TABLE pacote (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Key
    documento_id BIGINT NOT NULL REFERENCES documento(id) ON DELETE CASCADE,

    -- Metadados
    numero_pacote VARCHAR(50) NOT NULL,                -- Ex: "PACOTE_BENFEI_001"
    descricao VARCHAR(255),                            -- Ex: "RelBen + Bol + CP Vale Alimentação"

    -- Status de composição
    completo BOOLEAN NOT NULL DEFAULT FALSE,           -- Todos os itens recebidos?
    data_composicao_concluida TIMESTAMP,               -- Quando virou COMPLETO

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2.7 Tabela: pacote_item
-- Relação N:N entre pacote e versao_documento
-- ============================================================================
CREATE TABLE pacote_item (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Keys
    pacote_id BIGINT NOT NULL REFERENCES pacote(id) ON DELETE CASCADE,
    versao_documento_id BIGINT NOT NULL REFERENCES versao_documento(id),

    -- Sequência
    numero_item INTEGER NOT NULL,                      -- Ordem do item no pacote (1, 2, 3...)

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(pacote_id, numero_item)
);

-- ============================================================================
-- 2.8 Tabela: destino_envio
-- Um par (documento, portal destino) — Atlas e Bernhoeft independentes
-- ============================================================================
CREATE TABLE destino_envio (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Key
    documento_id BIGINT NOT NULL REFERENCES documento(id) ON DELETE CASCADE,

    -- Portal destino
    portal_destino VARCHAR(50) NOT NULL,               -- 'atlas' | 'bernhoeft'

    -- Estado específico deste destino
    estado enum_destino_estado NOT NULL DEFAULT 'PENDENTE_ENVIO',

    -- Rastreamento
    tentativa_envio_count INTEGER NOT NULL DEFAULT 0,
    ultima_tentativa TIMESTAMP,

    -- Chave de negócio composta
    -- Um documento só pode ter um destino_envio por portal
    UNIQUE(documento_id, portal_destino),

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2.9 Tabela: tentativa_envio
-- Cada tentativa de envio de um destino_envio
-- ============================================================================
CREATE TABLE tentativa_envio (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Key
    destino_envio_id BIGINT NOT NULL REFERENCES destino_envio(id) ON DELETE CASCADE,
    versao_documento_id BIGINT NOT NULL REFERENCES versao_documento(id),

    -- Status da tentativa
    resultado enum_resultado_envio NOT NULL,
    detalhes_erro TEXT,

    -- Payload e resposta (para auditoria)
    payload_json JSONB,                                -- O que foi enviado ao portal
    resposta_json JSONB,                               -- O que o portal retornou

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 2.10 Tabela: protocolo
-- Número/protocolo devolvido pelo portal quando aceito
-- ============================================================================
CREATE TABLE protocolo (
    id BIGSERIAL PRIMARY KEY,

    -- Foreign Keys
    tentativa_envio_id BIGINT NOT NULL UNIQUE REFERENCES tentativa_envio(id),
    destino_envio_id BIGINT NOT NULL REFERENCES destino_envio(id),

    -- Número do protocolo
    numero_protocolo VARCHAR(100) NOT NULL,            -- Ex: "ATLAS-20240824-001"
    portal_destino VARCHAR(50) NOT NULL,               -- 'atlas' | 'bernhoeft' (redundante, para query)

    -- Data de aprovação
    data_aprovacao TIMESTAMP NOT NULL,

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints
    UNIQUE(numero_protocolo, portal_destino)
);

-- ============================================================================
-- 2.11 Tabela: alerta
-- Pendência/atraso vinculado a documento ou destino_envio
-- ============================================================================
CREATE TABLE alerta (
    id BIGSERIAL PRIMARY KEY,

    -- Tipo
    tipo_alerta VARCHAR(50) NOT NULL,                  -- Ex: 'vencimento_proximo', 'sem_retorno', 'pacote_incompleto'
    severidade VARCHAR(20) NOT NULL,                   -- 'baixa' | 'media' | 'alta' | 'critica'

    -- Associações (uma ou outra, nunca ambas)
    documento_id BIGINT REFERENCES documento(id),
    destino_envio_id BIGINT REFERENCES destino_envio(id),

    -- Metadados
    descricao TEXT NOT NULL,                           -- Mensagem legível (ex: "CRF vence em 5 dias")
    data_prevista_evento DATE,                         -- Quando vai vencer/expirar/alcançar prazo
    dias_antecedencia_acionado INTEGER,                -- Quantos dias antes da data foi criado (ex: -5)

    -- Consumo (Macro 7)
    consumido BOOLEAN NOT NULL DEFAULT FALSE,          -- Macro 7 já notificou?
    data_consumo TIMESTAMP,                            -- Quando foi notificado

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Constraints (uma ou outra associação, nunca ambas)
    CHECK ((documento_id IS NOT NULL AND destino_envio_id IS NULL) OR
           (documento_id IS NULL AND destino_envio_id IS NOT NULL))
);

-- ============================================================================
-- 2.12 Tabela: auditoria
-- Log append-only de toda transição de estado
-- ============================================================================
CREATE TABLE auditoria (
    id BIGSERIAL PRIMARY KEY,

    -- Tipo de evento
    tipo_evento VARCHAR(100) NOT NULL,                 -- Ex: 'novo_arquivo', 'validacao_ok', 'envio_realizado'

    -- Associação
    documento_id BIGINT REFERENCES documento(id) ON DELETE CASCADE,
    destino_envio_id BIGINT REFERENCES destino_envio(id) ON DELETE CASCADE,
    tentativa_envio_id BIGINT REFERENCES tentativa_envio(id) ON DELETE CASCADE,

    -- Dados da transição
    estado_anterior VARCHAR(50),                       -- Estado antes do evento
    estado_novo VARCHAR(50),                           -- Estado depois do evento
    dados_evento JSONB,                                -- Contexto adicional (ex: hash_arquivo, erro_portal)

    -- Responsabilidade
    ator VARCHAR(255),                                 -- 'sistema', 'workflow:n8n', 'operator:nome', etc

    -- Auditoria
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 3. ÍNDICES — Performance e Queries Comuns
-- ============================================================================

-- regra_documento
CREATE INDEX idx_regra_documento_indice_origem ON regra_documento(indice_origem);
CREATE INDEX idx_regra_documento_grupo ON regra_documento(grupo);
CREATE INDEX idx_regra_documento_tipo_entidade ON regra_documento(tipo_entidade);
CREATE INDEX idx_regra_documento_tem_validade ON regra_documento(tem_validade) WHERE tem_validade = TRUE;

-- entidade
CREATE INDEX idx_entidade_tipo ON entidade(tipo);
CREATE INDEX idx_entidade_cpf_ou_cnpj ON entidade(cpf_ou_cnpj);
CREATE INDEX idx_entidade_ativo ON entidade(ativo);

-- contrato_projeto
CREATE INDEX idx_contrato_projeto_numero ON contrato_projeto(numero_contrato);
CREATE INDEX idx_contrato_projeto_ativo ON contrato_projeto(ativo);

-- documento
CREATE INDEX idx_documento_regra_id ON documento(regra_documento_id);
CREATE INDEX idx_documento_entidade_id ON documento(entidade_id);
CREATE INDEX idx_documento_contrato_id ON documento(contrato_projeto_id);
CREATE INDEX idx_documento_estado ON documento(estado);
CREATE INDEX idx_documento_competencia ON documento(competencia_ou_evento);
CREATE INDEX idx_documento_chave_negocio ON documento(regra_documento_id, entidade_id, competencia_ou_evento, contrato_projeto_id);

-- versao_documento
CREATE INDEX idx_versao_documento_id ON versao_documento(documento_id);
CREATE INDEX idx_versao_documento_hash ON versao_documento(hash_sha256);

-- pacote
CREATE INDEX idx_pacote_documento_id ON pacote(documento_id);
CREATE INDEX idx_pacote_numero ON pacote(numero_pacote);

-- pacote_item
CREATE INDEX idx_pacote_item_pacote_id ON pacote_item(pacote_id);
CREATE INDEX idx_pacote_item_versao_id ON pacote_item(versao_documento_id);

-- destino_envio
CREATE INDEX idx_destino_envio_documento_id ON destino_envio(documento_id);
CREATE INDEX idx_destino_envio_portal ON destino_envio(portal_destino);
CREATE INDEX idx_destino_envio_estado ON destino_envio(estado);
CREATE INDEX idx_destino_envio_documento_portal ON destino_envio(documento_id, portal_destino);

-- tentativa_envio
CREATE INDEX idx_tentativa_envio_destino_id ON tentativa_envio(destino_envio_id);
CREATE INDEX idx_tentativa_envio_versao_id ON tentativa_envio(versao_documento_id);
CREATE INDEX idx_tentativa_envio_resultado ON tentativa_envio(resultado);

-- protocolo
CREATE INDEX idx_protocolo_numero ON protocolo(numero_protocolo);
CREATE INDEX idx_protocolo_destino_id ON protocolo(destino_envio_id);

-- alerta
CREATE INDEX idx_alerta_tipo ON alerta(tipo_alerta);
CREATE INDEX idx_alerta_documento_id ON alerta(documento_id);
CREATE INDEX idx_alerta_destino_envio_id ON alerta(destino_envio_id);
CREATE INDEX idx_alerta_consumido ON alerta(consumido);
CREATE INDEX idx_alerta_data_prevista ON alerta(data_prevista_evento);

-- auditoria
CREATE INDEX idx_auditoria_tipo_evento ON auditoria(tipo_evento);
CREATE INDEX idx_auditoria_documento_id ON auditoria(documento_id);
CREATE INDEX idx_auditoria_destino_envio_id ON auditoria(destino_envio_id);
CREATE INDEX idx_auditoria_criado_em ON auditoria(criado_em);

-- ============================================================================
-- 4. COMENTÁRIOS (Documentação inline)
-- ============================================================================

COMMENT ON TABLE regra_documento IS 'Tipos de documento da matriz (116 possíveis, 36 para Equatorial). Seed de configuração, não muda em produção.';
COMMENT ON TABLE entidade IS 'Entidades (colaboradores CPF ou empresas CNPJ) que são sujeitos de documentos.';
COMMENT ON TABLE contrato_projeto IS 'Contratos/projetos (obras) — nem todo documento tem; nullable.';
COMMENT ON TABLE documento IS 'Instância de documento: cruzamento regra_documento + entidade + competência. Estado principal.';
COMMENT ON TABLE versao_documento IS 'Histórico de versões (arquivos) de um documento. Rastreabilidade + idempotência.';
COMMENT ON TABLE pacote IS 'Agrupamento de itens "+" que precisam merge PDF antes envio. Só para grupo=pacote.';
COMMENT ON TABLE pacote_item IS 'Itens do pacote. Controla completude (todos os itens chegaram?).';
COMMENT ON TABLE destino_envio IS 'Detalhe do envio para cada portal (Atlas, Bernhoeft). Independente por portal.';
COMMENT ON TABLE tentativa_envio IS 'Cada tentativa de envio de um destino. Rastreabilidade de retentativas.';
COMMENT ON TABLE protocolo IS 'Números de protocolo aceitos pelos portais. 1:1 com tentativa_envio bem-sucedida.';
COMMENT ON TABLE alerta IS 'Alertas de atraso/vencimento. Consumidos pela Macro 7 (notificações).';
COMMENT ON TABLE auditoria IS 'Log append-only de transições de estado. Nunca editado, só inserido. Reconstrução pós-queda.';

-- ============================================================================
-- 5. VIEWS AUXILIARES (Derivadas)
-- ============================================================================

-- View: Estado consolidado do documento (resumo dos destino_envio)
CREATE VIEW vw_documento_estado_consolidado AS
SELECT
    d.id,
    d.regra_documento_id,
    d.entidade_id,
    d.competencia_ou_evento,
    d.estado AS estado_documento,
    CASE
        -- Simples (só um portal)
        WHEN COUNT(DISTINCT de.portal_destino) = 1 THEN
            MAX(de.estado)::TEXT
        -- Dois portais: verifica se está sincronizado
        WHEN COUNT(DISTINCT de.portal_destino) = 2 AND
             COUNT(DISTINCT de.estado) = 1 THEN
            'SINCRONIZADO_' || MAX(de.estado)::TEXT
        -- Dois portais: Atlas aprovado, outro não
        WHEN COUNT(DISTINCT de.portal_destino) = 2 AND
             (MAX(CASE WHEN de.portal_destino = 'atlas' THEN de.estado::TEXT END) = 'APROVADO') THEN
            'PARCIALMENTE_APROVADO'
        ELSE 'MULTIPLO_ESTADO'
    END AS estado_consolidado
FROM documento d
LEFT JOIN destino_envio de ON d.id = de.documento_id
GROUP BY d.id, d.regra_documento_id, d.entidade_id, d.competencia_ou_evento, d.estado;

COMMENT ON VIEW vw_documento_estado_consolidado IS
    'Resumo do estado de um documento considerando todos seus destino_envio.
     Usado para: (1) não reenviar para portal já APROVADO, (2) dashboard de progresso.';

-- ============================================================================
-- 6. FUNÇÃO: Lock distribuído (Redis simulation em PostgreSQL)
-- ============================================================================

CREATE TABLE redis_lock_simulation (
    chave_lock VARCHAR(255) PRIMARY KEY,
    ttl_até TIMESTAMP NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE redis_lock_simulation IS
    'Simulação de Redis SETNX para lock distribuído. Em produção, usar Redis real.
     Evita processamento concorrente da mesma chave de negócio.';

-- ============================================================================
-- FIM DO DDL — Pronto para Seed de dados (ticket 3.3)
-- ============================================================================
