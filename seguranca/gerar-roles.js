// Gera senhas novas e monta, FORA do repositório e do OneDrive, os arquivos para criar as roles de mínimo privilégio:
//   %LOCALAPPDATA%\gesdoc-segredos\<data>\roles-com-senha.sql   (CREATE ROLE ... PASSWORD + seguranca/roles.sql) -> SQL Editor do Neon como neondb_owner
//   %LOCALAPPDATA%\gesdoc-segredos\<data>\urls.env              (PAINEL_DATABASE_URL, SINC_DATABASE_URL e, com --robo, ROBO_DATABASE_URL)
// Só imprime os caminhos, nunca senha nem URL. Host e banco vêm da ROBO_DATABASE_URL atual (ou ROBO_ENV_FILE).
// Uso: node seguranca/gerar-roles.js [--robo | --so-robo]
//   --robo     também troca a senha do robo_atlas (ALTER ROLE)
//   --so-robo  só o ALTER ROLE do robo_atlas (roles já criadas; sem CREATE ROLE nem roles.sql)
// Depois de pôr as URLs no cofre e no serviço do Evilásio: apagar a pasta gerada.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function conexao() {
  let url = process.env.ROBO_DATABASE_URL;
  if (!url && process.env.ROBO_ENV_FILE) {
    const l = fs.readFileSync(process.env.ROBO_ENV_FILE, 'utf8').split(/\r?\n/).find((x) => x.startsWith('ROBO_DATABASE_URL='));
    if (l) url = l.slice('ROBO_DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  return url || null;
}

// 32 bytes = 256 bits (o Neon exige pelo menos 60 bits em senha criada por SQL). base64url: sem aspas, barra nem %.
const senha = () => crypto.randomBytes(32).toString('base64url');

const base = conexao();
if (!base) { console.error('Sem ROBO_DATABASE_URL/ROBO_ENV_FILE para saber o host do Neon.'); process.exit(1); }
const modelo = new URL(base);
const url = (usuario, pw) => { const u = new URL(modelo.href); u.username = usuario; u.password = pw; return u.href; };

const soRobo = process.argv.includes('--so-robo');
const trocarRobo = soRobo || process.argv.includes('--robo');
const roles = soRobo ? [] : [['painel_leitura', 'PAINEL_DATABASE_URL'], ['sinc_factorial', 'SINC_DATABASE_URL']];
const sqlRoles = [];
const env = [];
for (const [nome, chave] of roles) {
  const pw = senha();
  sqlRoles.push(`CREATE ROLE ${nome} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '${pw}';`);
  env.push(`${chave}=${url(nome, pw)}`);
}
if (trocarRobo) {
  const pw = senha();
  sqlRoles.push(`ALTER ROLE robo_atlas WITH PASSWORD '${pw}';`);
  env.push(`ROBO_DATABASE_URL=${url('robo_atlas', pw)}`);
}

const corpo = soRobo ? '' : fs.readFileSync(path.join(__dirname, 'roles.sql'), 'utf8');
const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'gesdoc-segredos', new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
// Os CREATE ROLE ficam fora da transação do roles.sql: se o GRANT falhar, as roles existem sem permissão nenhuma (seguro) e é só rodar o roles.sql de novo.
fs.writeFileSync(path.join(dir, 'roles-com-senha.sql'), `-- Gerado por gerar-roles.js. Contém senhas: apagar depois de usar.\n${sqlRoles.join('\n')}\n\n${corpo}`);
fs.writeFileSync(path.join(dir, 'urls.env'), env.join('\n') + '\n');
console.log(`Gerado em ${dir}\n  roles-com-senha.sql -> SQL Editor do Neon (neondb_owner)\n  urls.env            -> cofre hml (cofre-juntar.sh) e serviço do Evilásio`);
