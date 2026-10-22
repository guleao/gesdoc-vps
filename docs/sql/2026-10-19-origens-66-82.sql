-- Corrige a origem de 2 tipos em documento_regras (discovery da Milena, v2, 19/10). Rodar como owner no Neon (o robo_atlas não tem UPDATE).
--   66 Relatório mensal de ocorrências: a Milena baixa o modelo no próprio Atlas e preenche (não vem do SharePoint).
--   82 CNDT: "não fica armazenado em nenhum local"; sai do site do TST pelo CNPJ, com captcha.
-- Efeito: o sharepoint.js deixa de buscar esses dois (ele só pega origem = 'SharePoint') e o painel mostra a origem nova
-- na aba 2 ("De onde vem cada documento") e na coluna "vem de". A sincronização do Evilásio só lê origem = 'Factorial': não muda nada nela.
-- Desfazer: update documento_regras set origem = 'SharePoint' where doc_id in (66, 82);
begin;
select doc_id, nome, origem from documento_regras where doc_id in (66, 82) order by doc_id;
update documento_regras set origem = 'Atlas (modelo)' where doc_id = 66 and origem = 'SharePoint';
update documento_regras set origem = 'TST' where doc_id = 82 and origem = 'SharePoint';
select doc_id, nome, origem from documento_regras where doc_id in (66, 82) order by doc_id;
commit;
