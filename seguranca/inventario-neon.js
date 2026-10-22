// Inventário de segurança do Neon, SOMENTE LEITURA (só SELECT em catálogos do Postgres; não lê dados de pessoas).
// Mostra: roles e atributos, quem é membro de quem, dono e ACL de cada tabela/sequência, ACL do banco e do schema,
// privilégios padrão, RLS, FKs com a regra de DELETE e funções SECURITY DEFINER.
// Uso: node seguranca/inventario-neon.js   (conexão: ROBO_DATABASE_URL ou ROBO_ENV_FILE, igual ao neon.js; nunca imprime a URL)
'use strict';
const fs = require('fs');
const path = require('path');
const { neon } = require(path.join(__dirname, '..', 'atlas-robo', 'node_modules', '@neondatabase', 'serverless'));

function conexao() {
  let url = process.env.ROBO_DATABASE_URL;
  if (!url && process.env.ROBO_ENV_FILE) {
    const l = fs.readFileSync(process.env.ROBO_ENV_FILE, 'utf8').split(/\r?\n/).find((x) => x.startsWith('ROBO_DATABASE_URL='));
    if (l) url = l.slice('ROBO_DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  return url || null;
}

const CONSULTAS = [
  ['Conectado como', `select current_user as usuario, current_database() as banco, split_part(version(), ' ', 2) as postgres`],
  ['Roles (sem as internas pg_*)', `select rolname, rolcanlogin as login, rolsuper as super, rolcreaterole as cria_role, rolcreatedb as cria_db,
     rolbypassrls as ignora_rls, rolinherit as herda, rolconnlimit as lim_conexoes, rolvaliduntil::text as validade
     from pg_roles where rolname !~ '^pg_' order by rolname`],
  ['Quem é membro de quem', `select m.rolname as membro, r.rolname as role, a.admin_option as admin
     from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member
     where m.rolname !~ '^pg_' order by 1, 2`],
  ['Banco: dono e ACL', `select datname, pg_get_userbyid(datdba) as dono, coalesce(datacl::text, '(padrão: PUBLIC conecta)') as acl
     from pg_database where datname = current_database()`],
  ['Schemas: dono e ACL', `select nspname, pg_get_userbyid(nspowner) as dono, coalesce(nspacl::text, '(padrão)') as acl
     from pg_namespace where nspname !~ '^(pg_|information_schema)' order by 1`],
  ['Tabelas, views e sequências: dono, RLS e ACL', `select n.nspname as schema, c.relname as nome,
     case c.relkind when 'r' then 'tabela' when 'v' then 'view' when 'm' then 'mview' when 'S' then 'sequência' when 'p' then 'tabela part.' else c.relkind::text end as tipo,
     pg_get_userbyid(c.relowner) as dono, c.relrowsecurity as rls, coalesce(c.relacl::text, '(só o dono)') as acl
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r','v','m','S','p') and n.nspname !~ '^(pg_|information_schema)' order by 1, 3, 2`],
  ['Privilégios por coluna (GRANT em colunas)', `select c.relname as tabela, a.attname as coluna, a.attacl::text as acl
     from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     where a.attacl is not null and n.nspname !~ '^(pg_|information_schema)' order by 1, 2`],
  ['Privilégios padrão (ALTER DEFAULT PRIVILEGES)', `select pg_get_userbyid(d.defaclrole) as de, coalesce(n.nspname, '(todos)') as schema,
     case d.defaclobjtype when 'r' then 'tabelas' when 'S' then 'sequências' when 'f' then 'funções' when 'T' then 'tipos' else d.defaclobjtype::text end as objetos,
     d.defaclacl::text as acl
     from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2`],
  ['Políticas de RLS', `select schemaname, tablename, policyname, roles::text, cmd from pg_policies order by 1, 2, 3`],
  ['FKs: regra no DELETE/UPDATE do pai', `select c.conrelid::regclass::text as tabela, c.conname as fk, c.confrelid::regclass::text as referencia,
     case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_delete,
     case c.confupdtype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end as on_update
     from pg_constraint c join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname !~ '^(pg_|information_schema)' order by 1, 2`],
  ['Funções SECURITY DEFINER', `select n.nspname as schema, p.proname as funcao, pg_get_userbyid(p.proowner) as dono, coalesce(p.proacl::text, '(PUBLIC executa)') as acl
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef and n.nspname !~ '^(pg_|information_schema)' order by 1, 2`],
  ['Extensões', `select extname, extversion, pg_get_userbyid(extowner) as dono from pg_extension order by 1`],
  ['Minhas permissões efetivas (current_user) nas tabelas do public', `select c.relname as tabela,
     has_table_privilege(c.oid, 'SELECT') as sel, has_table_privilege(c.oid, 'INSERT') as ins,
     has_table_privilege(c.oid, 'UPDATE') as upd, has_table_privilege(c.oid, 'DELETE') as del,
     has_table_privilege(c.oid, 'TRUNCATE') as trunc, has_table_privilege(c.oid, 'REFERENCES') as refs
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v','p') order by 1`],
  ['Posso criar no schema public / no banco?', `select has_schema_privilege('public', 'CREATE') as cria_no_public,
     has_database_privilege(current_database(), 'CREATE') as cria_schema, has_database_privilege(current_database(), 'TEMP') as cria_temp`],
];

function tabela(linhas) {
  if (!linhas.length) return '_(nada)_\n';
  const cols = Object.keys(linhas[0]);
  const fmt = (v) => (v == null ? '' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...linhas.map((l) => `| ${cols.map((c) => fmt(l[c])).join(' | ')} |`)].join('\n') + '\n';
}

(async () => {
  const url = conexao();
  if (!url) throw new Error('Sem conexão com o Neon (defina ROBO_DATABASE_URL ou ROBO_ENV_FILE).');
  const sql = neon(url);
  const saida = [`# Inventário do Neon (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, só leitura)\n`];
  for (const [titulo, q] of CONSULTAS) {
    let corpo;
    try { corpo = tabela(await sql.query(q)); } catch (e) { corpo = `_erro: ${e.message}_\n`; }
    saida.push(`## ${titulo}\n\n${corpo}`);
  }
  console.log(saida.join('\n'));
})().catch((e) => { console.error('Falhou:', e.message); process.exit(1); });
