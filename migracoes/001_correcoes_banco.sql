-- 001 — Correções do banco apontadas na Revisão Macro
-- Aplicada em produção (br-tiny-queen) e no branch de teste (br-purple-dream) em 19/10/2026.
--
-- 1. Tabelas de evidência com RESTRICT em vez de CASCADE (apagar uma pendência não apaga mais o histórico).
-- 2. Protocolos 1:N por pendência e destino (permite reenviar depois de uma rejeição).
-- 3. Destinos por regra (multiportal, ex.: 78/79 Atlas + Bernhoeft) e estado por destino (ticket 6.9).
-- 4. Reconciliação: a situação lida do portal Atlas atualiza o estado por destino, e uma reprovação
--    tira a pendência da fila de envio (estado REJEITADO), para o mesmo arquivo não ser reenviado.
-- 5. atualizado_em mantido por trigger e só alterado quando a linha muda de fato.
-- 6. Chave natural única de pendência.
-- 7. View v_documentos_status com os estados que o sistema grava.
-- 8. Grupo de permissões mínimo para a sincronização (gesdoc_sync_perm).
--
-- Roda numa transação: ou aplica tudo, ou nada.

BEGIN;

-- 1 ─────────────────────────────────────────────── RESTRICT nas tabelas de evidência
ALTER TABLE alerta
  DROP CONSTRAINT alerta_documento_id_fkey,
  ADD CONSTRAINT alerta_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE RESTRICT;
ALTER TABLE documento_envios
  DROP CONSTRAINT documento_envios_documento_id_fkey,
  ADD CONSTRAINT documento_envios_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE RESTRICT;
ALTER TABLE documento_protocolos
  DROP CONSTRAINT documento_protocolos_documento_id_fkey,
  ADD CONSTRAINT documento_protocolos_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE RESTRICT;
ALTER TABLE idempotencia
  DROP CONSTRAINT idempotencia_documento_id_fkey,
  ADD CONSTRAINT idempotencia_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE RESTRICT;
ALTER TABLE documento_reprocessamento
  DROP CONSTRAINT documento_reprocessamento_documento_id_fkey,
  ADD CONSTRAINT documento_reprocessamento_documento_id_fkey FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE RESTRICT;

-- 2 ─────────────────────────────────────────────── protocolos 1:N
ALTER TABLE documento_protocolos DROP CONSTRAINT documento_protocolos_documento_id_key;
ALTER TABLE documento_protocolos ADD COLUMN tentativa integer NOT NULL DEFAULT 1;
ALTER TABLE documento_protocolos
  ADD CONSTRAINT documento_protocolos_tentativa_key UNIQUE (documento_id, plataforma, tentativa);

-- 3 ─────────────────────────────────────────────── destinos por regra e estado por destino
CREATE TABLE documento_regra_destinos (
  doc_id  integer NOT NULL REFERENCES documento_regras(doc_id) ON DELETE RESTRICT,
  destino varchar NOT NULL,
  PRIMARY KEY (doc_id, destino)
);
INSERT INTO documento_regra_destinos (doc_id, destino)
SELECT doc_id, destino FROM documento_regras WHERE destino IS NOT NULL;
-- 78 (ASO Admissional) e 79 (Ficha de Registro): Atlas + Bernhoeft, conforme a ficha funcional e o checklist 3.1
INSERT INTO documento_regra_destinos (doc_id, destino)
SELECT doc_id, 'Bernhoeft' FROM documento_regras WHERE doc_id IN (78, 79)
ON CONFLICT DO NOTHING;

CREATE TABLE documento_destinos (
  id              serial PRIMARY KEY,
  documento_id    integer NOT NULL REFERENCES documentos(id) ON DELETE RESTRICT,
  destino         varchar NOT NULL,
  estado          varchar NOT NULL DEFAULT 'PENDENTE',
  situacao_portal varchar,
  criado_em       timestamp NOT NULL DEFAULT now(),
  atualizado_em   timestamp NOT NULL DEFAULT now(),
  UNIQUE (documento_id, destino),
  CHECK (estado IN ('PENDENTE', 'ENVIADO', 'APROVADO', 'REJEITADO'))
);
ALTER TABLE documento_protocolos ADD COLUMN destino_id integer REFERENCES documento_destinos(id) ON DELETE RESTRICT;

-- estado por destino a partir da situação que o portal informa (hoje só o Atlas é lido)
CREATE FUNCTION estado_por_situacao(situacao varchar, estado_atual varchar) RETURNS varchar
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN situacao ILIKE 'Reprovado%' THEN 'REJEITADO'
    WHEN situacao ILIKE 'Aprovado%' OR situacao ILIKE 'Validado%' THEN 'APROVADO'
    ELSE estado_atual
  END
$$;

INSERT INTO documento_destinos (documento_id, destino, estado, situacao_portal)
SELECT d.id, rd.destino,
       CASE WHEN rd.destino = 'Atlas' THEN
              estado_por_situacao(d.situacao, CASE WHEN d.estado = 'ENVIADO' THEN 'ENVIADO' ELSE 'PENDENTE' END)
            ELSE 'PENDENTE' END,
       CASE WHEN rd.destino = 'Atlas' THEN d.situacao END
FROM documentos d
JOIN documento_regra_destinos rd ON rd.doc_id = d.doc_id;

-- 4 ─────────────────────────────────────────────── reconciliação estado × situação do portal
-- Funções SECURITY DEFINER: os robôs (role robo_atlas) não precisam de permissão nas tabelas novas.
CREATE FUNCTION documentos_criar_destinos() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO documento_destinos (documento_id, destino, estado, situacao_portal)
  SELECT NEW.id, rd.destino,
         CASE WHEN rd.destino = 'Atlas' THEN estado_por_situacao(NEW.situacao, 'PENDENTE') ELSE 'PENDENTE' END,
         CASE WHEN rd.destino = 'Atlas' THEN NEW.situacao END
  FROM documento_regra_destinos rd WHERE rd.doc_id = NEW.doc_id
  ON CONFLICT (documento_id, destino) DO NOTHING;
  RETURN NULL;
END $$;

CREATE TRIGGER documentos_criar_destinos AFTER INSERT ON documentos
FOR EACH ROW EXECUTE FUNCTION documentos_criar_destinos();

CREATE FUNCTION documentos_sincronizar_situacao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE documento_destinos
     SET situacao_portal = NEW.situacao,
         estado = estado_por_situacao(NEW.situacao, estado),
         atualizado_em = now()
   WHERE documento_id = NEW.id AND destino = 'Atlas'
     AND situacao_portal IS DISTINCT FROM NEW.situacao;
  RETURN NULL;
END $$;

CREATE TRIGGER documentos_sincronizar_situacao AFTER UPDATE OF situacao ON documentos
FOR EACH ROW WHEN (OLD.situacao IS DISTINCT FROM NEW.situacao)
EXECUTE FUNCTION documentos_sincronizar_situacao();

-- Reprovação no portal tira da fila de envio quem já tinha arquivo (não reenviar o mesmo arquivo).
-- Pendências sem arquivo continuam na fila: ainda é preciso achar o documento.
CREATE FUNCTION documentos_rejeicao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.situacao ILIKE 'Reprovado%'
     AND NEW.situacao IS DISTINCT FROM OLD.situacao
     AND NEW.estado IN ('LOCALIZADO', 'COMPOSTO', 'ENVIADO') THEN
    NEW.estado := 'REJEITADO';
  END IF;
  RETURN NEW;
END $$;

-- 5 ─────────────────────────────────────────────── atualizado_em só quando a linha muda
CREATE FUNCTION documentos_atualizado_em() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'atualizado_em') = (to_jsonb(OLD) - 'atualizado_em') THEN
    NEW.atualizado_em := OLD.atualizado_em;
  ELSE
    NEW.atualizado_em := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;

-- a ordem alfabética define a ordem de execução: primeiro a rejeição, depois o carimbo de data
CREATE TRIGGER documentos_a_rejeicao BEFORE UPDATE ON documentos
FOR EACH ROW EXECUTE FUNCTION documentos_rejeicao();
CREATE TRIGGER documentos_b_atualizado_em BEFORE UPDATE ON documentos
FOR EACH ROW EXECUTE FUNCTION documentos_atualizado_em();

-- pendências que já tinham arquivo e foram reprovadas no portal
UPDATE documentos SET estado = 'REJEITADO'
 WHERE situacao ILIKE 'Reprovado%' AND estado IN ('LOCALIZADO', 'COMPOSTO', 'ENVIADO');

-- 6 ─────────────────────────────────────────────── chave natural da pendência
-- Os pares do doc 9 ("TRCT" × "TCRT com Comprovante") são itens distintos no Atlas e se distinguem pelo nome;
-- duas CND Federal com o mesmo pedido se distinguem pelo prazo.
CREATE UNIQUE INDEX documentos_chave_natural ON documentos
  (cliente, doc_id, cpf, cnpj_filial, competencia, nome, numero_pedido, prazo_envio) NULLS NOT DISTINCT;

-- 7 ─────────────────────────────────────────────── view de status com os estados reais
CREATE OR REPLACE VIEW v_documentos_status AS
SELECT dr.doc_id, dr.nome, dr.origem, dr.destino,
       d.id AS documento_pk, d.colaborador_id, d.estado, d.versao, d.hash_arquivo,
       dp.protocolo, dp.estado_protocolo, d.atualizado_em,
       CASE d.estado
         WHEN 'PENDENTE_ENVIO'           THEN '⚠️ Pendente'
         WHEN 'NAO_ENCONTRADO_FACTORIAL' THEN '🔎 Não encontrado na Factorial'
         WHEN 'DIVERGENTE_FACTORIAL'     THEN '⚠️ Divergente na Factorial'
         WHEN 'AGUARDANDO_ASSINATURA'    THEN '✍️ Aguardando assinatura'
         WHEN 'ERRO_COMPOSICAO'          THEN '❌ Erro ao unir o pacote'
         WHEN 'LOCALIZADO'               THEN '🔍 Localizado'
         WHEN 'COMPOSTO'                 THEN '📋 Pronto para envio'
         WHEN 'ENVIADO'                  THEN CASE WHEN dp.estado_protocolo = 'CONCLUÍDO' THEN '✅ Concluído' ELSE '⏳ Aguardando resposta' END
         WHEN 'REJEITADO'                THEN '❌ Reprovado no portal'
         WHEN 'APROVADO'                 THEN '✅ Concluído'
         ELSE '❓ Desconhecido'
       END AS status_leitura
FROM documento_regras dr
LEFT JOIN documentos d ON dr.doc_id = d.doc_id
LEFT JOIN LATERAL (
  SELECT protocolo, estado_protocolo FROM documento_protocolos p
   WHERE p.documento_id = d.id ORDER BY p.criado_em DESC LIMIT 1
) dp ON true;

-- 8 ─────────────────────────────────────────────── permissões mínimas da sincronização
-- Grupo sem login. Depois de criar o usuário gesdoc_sync no console do Neon: GRANT gesdoc_sync_perm TO gesdoc_sync;
CREATE ROLE gesdoc_sync_perm NOLOGIN;
GRANT SELECT ON documento_regras TO gesdoc_sync_perm;
GRANT SELECT, UPDATE ON documentos TO gesdoc_sync_perm;
GRANT INSERT ON alerta, documento_envios TO gesdoc_sync_perm;
GRANT USAGE ON SEQUENCE alerta_id_seq, documento_envios_id_seq TO gesdoc_sync_perm;
GRANT SELECT ON v_documentos_status TO gesdoc_sync_perm, robo_atlas;

COMMIT;
