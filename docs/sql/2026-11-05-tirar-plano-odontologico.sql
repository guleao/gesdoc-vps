-- 05/11/2026: tirar o doc 5 (plano odontológico) do sistema. Não existe esse benefício na NIP: foi um pedido errado desde o início.
-- Rodar como owner no SQL Editor do Neon (o robo_atlas não apaga nada). Tudo numa transação: se algo falhar, nada muda.
-- Antes (05/11): 5 linhas em documentos (10/2026, "Próximas entregas", PENDENTE_ENVIO) + 1 linha em documento_regras.
-- Os robôs já foram publicados sem o doc 5: o nome do Atlas fica "sem regra" e não volta a ser gravado.
begin;

-- conferir antes (deve dar 5 e 1)
select count(*) as documentos_doc5 from documentos where doc_id = 5;
select count(*) as regra_doc5 from documento_regras where doc_id = 5;

-- o que está ligado às 5 linhas e à regra com "on delete restrict" (alerta, envios, protocolos etc. saem em cascata)
delete from documento_destinos where documento_id in (select id from documentos where doc_id = 5);
delete from documento_regra_destinos where doc_id = 5;

delete from documentos where doc_id = 5;
delete from documento_regras where doc_id = 5;

-- conferir depois (deve dar 0 e 0)
select count(*) as documentos_doc5 from documentos where doc_id = 5;
select count(*) as regra_doc5 from documento_regras where doc_id = 5;

commit;
