// Testa seguranca/roles.sql num Postgres descartável (PGlite) que imita o Neon de 19/10 (tabelas, dono, grants atuais).
// Rodar fora do repo: copiar para uma pasta com `npm i @electric-sql/pglite` e `node teste-roles.mjs <caminho do GESDOC>`.
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

const repo = process.argv[2];
const db = new PGlite();
const banco = (await db.query('select current_database() d')).rows[0].d;

await db.exec(`
  create role neon_superuser nologin;
  create role neondb_owner login createrole;
  grant neon_superuser to neondb_owner;
  alter database ${banco} owner to neondb_owner;
  grant connect, create, temporary on database ${banco} to neon_superuser;
  set role neondb_owner;
  create role robo_atlas login password 'x';
  create table documento_regras (id serial primary key, doc_id int unique not null, nome varchar not null, origem varchar not null default 'Factorial',
    destino varchar not null default 'Atlas', ativo boolean default true, atualizado_em timestamp);
  create table documentos (id serial primary key, doc_id int not null references documento_regras(doc_id) on delete restrict,
    colaborador_id varchar, competencia varchar, estado varchar not null, versao int default 1, hash_arquivo varchar, tamanho_bytes bigint,
    caminho_origem varchar, data_criacao_documento date, criado_em timestamp default now(), atualizado_em timestamp, prazo_envio date,
    cliente varchar, unidade varchar, nome varchar, categoria varchar, aba varchar, situacao varchar, funcionario varchar, cpf varchar(11),
    tipo varchar, grupo varchar, numero_pedido varchar, cnpj_filial varchar(14), qtd_docs int, enviado_em timestamp, validado_em timestamp,
    validade date, critico boolean);
  create table alerta (id serial primary key, documento_id int references documentos(id) on delete cascade, descricao text, criado_em timestamp default now());
  create table documento_envios (id serial primary key, documento_id int references documentos(id) on delete cascade, x text);
  create table documento_protocolos (id serial primary key, documento_id int unique references documentos(id) on delete cascade, protocolo varchar unique);
  create table documento_reprocessamento (id serial primary key, documento_id int references documentos(id) on delete cascade, x text);
  create table idempotencia (id serial primary key, documento_id int references documentos(id) on delete cascade, plataforma_destino varchar, hash_entrada varchar);
  -- criadas no Neon em 19/10 (destino por pendência)
  create table documento_regra_destinos (doc_id int references documento_regras(doc_id) on delete restrict, destino varchar);
  create table documento_destinos (id serial primary key, documento_id int references documentos(id) on delete restrict, destino varchar, estado varchar,
    situacao_portal varchar, criado_em timestamp default now(), atualizado_em timestamp);
  create view v_documentos_status as select estado, count(*) from documentos group by 1;
  insert into documento_regras (doc_id, nome) values (67, 'ASO');
  insert into documentos (doc_id, estado) values (67, 'PENDENTE_ENVIO');
  grant connect on database ${banco} to robo_atlas;
  grant usage on schema public to robo_atlas;
  grant select, insert, update on documentos to robo_atlas;
  grant select on documento_regras to robo_atlas;
  grant select, usage on sequence documentos_id_seq to robo_atlas;
  reset role;
  create role intruso login;
`);

// Mesmo arquivo que o gerar-roles.js monta, trocando o nome do banco.
const corpo = fs.readFileSync(`${repo}/seguranca/roles.sql`, 'utf8').replaceAll('DATABASE neondb', `DATABASE ${banco}`);
await db.exec(`set role neondb_owner;
  create role painel_leitura with login nosuperuser nocreatedb nocreaterole nobypassrls noreplication password 'a';
  create role sinc_factorial with login nosuperuser nocreatedb nocreaterole nobypassrls noreplication password 'b';
  ${corpo}
  reset role;`);

let falhas = 0;
async function como(role, nome, sql, deveFuncionar) {
  let ok = true, msg = '';
  try { await db.exec(`begin; set local role ${role}; ${sql}; rollback;`); } catch (e) { ok = false; msg = e.message; await db.exec('rollback').catch(() => {}); }
  const certo = ok === deveFuncionar;
  if (!certo) falhas++;
  console.log(`${certo ? 'ok   ' : 'FALHA'} ${role.padEnd(15)} ${deveFuncionar ? 'pode   ' : 'não pode'} ${nome}${msg ? ' -> ' + msg.slice(0, 60) : ''}`);
}

const ins = `insert into documentos (doc_id, colaborador_id, competencia, estado, prazo_envio, cliente, unidade, nome, categoria, aba, situacao,
  funcionario, cpf, tipo, grupo, numero_pedido, cnpj_filial, qtd_docs, enviado_em, validado_em, validade, critico)
  values (67, null, '10/2026', 'PENDENTE_ENVIO', null, null, null, 'x', null, 'Atrasados', null, null, '1', null, null, null, null, 1, null, null, null, false)`;
await como('robo_atlas', 'ler documentos e regras', 'select * from documentos; select * from documento_regras', true);
await como('robo_atlas', 'inserir (neon.js)', ins, true);
await como('robo_atlas', 'atualizar sem estado (neon.js)', "update documentos set nome = 'y', aba = 'Atrasados', atualizado_em = now() where id = 1", true);
await como('robo_atlas', 'LOCALIZADO (factorial.js)', "update documentos set estado = 'LOCALIZADO', caminho_origem = 'f', tamanho_bytes = 1, hash_arquivo = 'h', atualizado_em = now() where id = 1 and estado = 'PENDENTE_ENVIO'", true);
await como('robo_atlas', 'ENVIADO (enviar.js)', "update documentos set estado = 'ENVIADO', enviado_em = now(), atualizado_em = now(), tamanho_bytes = 1, hash_arquivo = 'h' where id = 1", true);
await como('robo_atlas', 'mudar criado_em/versao', 'update documentos set criado_em = now(), versao = 9 where id = 1', false);
await como('robo_atlas', 'apagar documento', 'delete from documentos where id = 1', false);
await como('robo_atlas', 'ler alerta', 'select * from alerta', false);
await como('robo_atlas', 'mudar regras', 'update documento_regras set ativo = false', false);
await como('robo_atlas', 'criar tabela', 'create table t (x int)', false);

await como('painel_leitura', 'ler documentos, regras, alerta, view', 'select * from documentos; select * from documento_regras; select * from alerta; select * from v_documentos_status', true);
await como('painel_leitura', 'ler destinos, protocolos e etapas', 'select * from documento_regra_destinos; select * from documento_destinos; select * from documento_protocolos; select * from documento_envios', true);
await como('painel_leitura', 'atualizar documento_destinos', "update documento_destinos set estado = 'X'", false);
await como('painel_leitura', 'atualizar documento', "update documentos set estado = 'X'", false);
await como('painel_leitura', 'inserir alerta', "insert into alerta (documento_id, descricao) values (1, 'x')", false);

await como('sinc_factorial', 'ler regras e view', 'select * from documento_regras; select * from v_documentos_status', true);
await como('sinc_factorial', 'avançar documento', "update documentos set estado = 'COMPOSTO', versao = 2, atualizado_em = now() where id = 1", true);
await como('sinc_factorial', 'inserir documento', "insert into documentos (doc_id, estado) values (67, 'PENDENTE_ENVIO')", true);
await como('sinc_factorial', 'gravar alerta/envio/protocolo/reproc/idempotência', `insert into alerta (documento_id, descricao) values (1, 'x');
  insert into documento_envios (documento_id) values (1); insert into documento_protocolos (documento_id, protocolo) values (1, 'p');
  insert into documento_reprocessamento (documento_id) values (1); insert into idempotencia (documento_id) values (1)`, true);
await como('sinc_factorial', 'apagar documento', 'delete from documentos where id = 1', false);
await como('sinc_factorial', 'apagar idempotência', 'delete from idempotencia', false);
await como('sinc_factorial', 'mudar regras', 'update documento_regras set ativo = false', false);
await como('sinc_factorial', 'criar tabela', 'create table t (x int)', false);
await como('sinc_factorial', 'truncate', 'truncate alerta', false);

await como('intruso', 'ler documentos (role sem grant)', 'select * from documentos', false);
await como('intruso', 'criar tabela no public', 'create table t (x int)', false);
const priv = (await db.query(`select has_database_privilege('intruso', '${banco}', 'CONNECT') c, has_database_privilege('intruso', '${banco}', 'TEMP') t,
  has_database_privilege('robo_atlas', '${banco}', 'CONNECT') r, has_database_privilege('neon_superuser', '${banco}', 'CONNECT') n`)).rows[0];
const pOk = !priv.c && !priv.t && priv.r && priv.n;
if (!pOk) falhas++;
console.log(`${pOk ? 'ok   ' : 'FALHA'} banco: PUBLIC sem CONNECT/TEMP, robo_atlas e neon_superuser conectam ${JSON.stringify(priv)}`);
const lim = (await db.query(`select rolname, rolconnlimit from pg_roles where rolname in ('robo_atlas','painel_leitura','sinc_factorial') order by 1`)).rows;
console.log('limites de conexão:', lim.map((r) => `${r.rolname}=${r.rolconnlimit}`).join(' '));
console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
