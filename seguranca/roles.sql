-- Roles de mínimo privilégio do Neon (banco neondb). NÃO tem senha aqui: os CREATE ROLE com senha saem do gerar-roles.js,
-- que monta o arquivo final (CREATE ROLE + este arquivo) fora do repositório.
-- Rodar no SQL Editor do Neon como neondb_owner, na branch de produção. Tudo numa transação: se uma linha falhar, nada muda.
-- Conferir depois: node seguranca/inventario-neon.js com a URL de cada role (seção "Minhas permissões efetivas").
--
-- Estado em 19/10 (inventario-neon.js): só duas roles com login, neondb_owner (dono de tudo, membro de neon_superuser,
-- usado pela sincronização do Evilásio) e robo_atlas (robôs + painel). O painel lê "alerta" com o robo_atlas, que não tem
-- SELECT nela: o erro é engolido e o motivo da sincronização nunca aparece. PUBLIC conecta, cria TEMP e usa o schema public.
--
-- Por que SQL e não o console: role criada pelo console/API do Neon entra em neon_superuser (pg_read_all_data e
-- pg_write_all_data), o que anula o mínimo privilégio.

BEGIN;

-- 1. robo_atlas: robô Atlas (neon.js, factorial.js, compor.js, enviar.js, unir-pdfs.js).
--    Lê regras e documentos; insere e atualiza só as colunas que o código grava. Sem DELETE, sem TRUNCATE, sem id/versao/criado_em.
REVOKE ALL ON documentos, documento_regras FROM robo_atlas;
REVOKE ALL ON SEQUENCE documentos_id_seq FROM robo_atlas;
GRANT SELECT ON documentos, documento_regras TO robo_atlas;
-- = CAMPOS do neon.js
GRANT INSERT (doc_id, colaborador_id, competencia, estado, prazo_envio, cliente, unidade, nome, categoria, aba, situacao,
  funcionario, cpf, tipo, grupo, numero_pedido, cnpj_filial, qtd_docs, enviado_em, validado_em, validade, critico) ON documentos TO robo_atlas;
-- = CAMPOS do neon.js + o que factorial.js/compor.js/enviar.js gravam (caminho_origem, tamanho_bytes, hash_arquivo, atualizado_em)
GRANT UPDATE (doc_id, colaborador_id, competencia, estado, prazo_envio, cliente, unidade, nome, categoria, aba, situacao,
  funcionario, cpf, tipo, grupo, numero_pedido, cnpj_filial, qtd_docs, enviado_em, validado_em, validade, critico,
  caminho_origem, tamanho_bytes, hash_arquivo, atualizado_em) ON documentos TO robo_atlas;
GRANT USAGE ON SEQUENCE documentos_id_seq TO robo_atlas;
ALTER ROLE robo_atlas CONNECTION LIMIT 10;

-- 2. painel_leitura: painel da automação (server.js). Só lê.
-- Destinos, protocolos e histórico de etapas: o detalhe da pendência mostra "para onde foi" e as partes do PDF (19/10).
GRANT SELECT ON documentos, documento_regras, alerta, v_documentos_status,
  documento_regra_destinos, documento_destinos, documento_protocolos, documento_envios TO painel_leitura;
ALTER ROLE painel_leitura CONNECTION LIMIT 5;

-- 3. sinc_factorial: serviço de sincronização do Evilásio (sincronizacao_factorial.py), no lugar do neondb_owner.
--    Lê e grava as tabelas do fluxo; sem DELETE, TRUNCATE nem DDL. Confirmar com o Evilásio se o serviço apaga linhas
--    (idempotencia, documento_reprocessamento?) ou cria/altera tabelas ao subir; se sim, ajustar aqui, nunca voltar ao owner.
--    documento_regras: só leitura (mudança de regra é feita à mão pelo owner).
GRANT SELECT ON documento_regras, v_documentos_status TO sinc_factorial;
GRANT SELECT, INSERT, UPDATE ON documentos, alerta, documento_envios, documento_protocolos,
  documento_reprocessamento, idempotencia TO sinc_factorial;
GRANT USAGE ON SEQUENCE documentos_id_seq, alerta_id_seq, documento_envios_id_seq, documento_protocolos_id_seq,
  documento_reprocessamento_id_seq, idempotencia_id_seq TO sinc_factorial;
ALTER ROLE sinc_factorial CONNECTION LIMIT 20;

-- 4. Fechar o que é de todos (PUBLIC). neon_superuser já tem CONNECT explícito no banco, então o Neon continua entrando.
REVOKE CONNECT, TEMPORARY ON DATABASE neondb FROM PUBLIC;
REVOKE CREATE, USAGE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE neondb TO robo_atlas, painel_leitura, sinc_factorial;
GRANT USAGE ON SCHEMA public TO robo_atlas, painel_leitura, sinc_factorial;

COMMIT;
