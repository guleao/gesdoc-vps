# Fechar o banco (prioridade 1 de 19/10)

Objetivo: ninguém usa o `neondb_owner` no dia a dia; cada serviço tem uma role com o mínimo; só IPs conhecidos chegam ao Neon.

## Como está hoje (inventário de 19/10, `node seguranca/inventario-neon.js`)
| quem | role | onde está a URL |
|---|---|---|
| robô Atlas (VPS) | `robo_atlas` (SELECT/INSERT/UPDATE em documentos, SELECT em regras) | cofre hml `ROBO_DATABASE_URL`; `Desktop\env.robo` (no OneDrive, sincroniza: tirar dali) |
| painel (VPS) | `robo_atlas` (pode gravar sem precisar; não lê `alerta`, por isso o motivo da sincronização sai vazio) | cofre hml `ROBO_DATABASE_URL` |
| sincronização do Evilásio | `neondb_owner` (dono de tudo, CREATEROLE, membro de `neon_superuser`) | `.env` do Evilásio; credenciais dele já apareceram no git |
| PUBLIC (qualquer role) | CONNECT, TEMP no banco, USAGE no schema public | - |

FKs de `alerta`, `documento_envios`, `documento_protocolos`, `documento_reprocessamento` e `idempotencia` são `ON DELETE CASCADE`: apagar um documento apaga o histórico dele (a troca para RESTRICT entra na migração do item 5).

## Arquivos
- `roles.sql`: os GRANT/REVOKE (sem senha). Cria o mínimo para `robo_atlas`, `painel_leitura` e `sinc_factorial` e fecha o PUBLIC.
- `gerar-roles.js`: gera senhas e escreve em `%LOCALAPPDATA%\gesdoc-segredos\<data>\` o `roles-com-senha.sql` e o `urls.env`. Só imprime os caminhos.
- `inventario-neon.js`: só leitura; serve para conferir antes e depois (rodar com a URL de cada role).
- `teste-roles.mjs`: testa o `roles.sql` num Postgres descartável (PGlite) que imita o Neon. Passou 26/26 em 19/10.
  Rodar: copiar para uma pasta com `npm i @electric-sql/pglite` e `node teste-roles.mjs <caminho do GESDOC>`.
- Painel: `server.js` usa `PAINEL_DATABASE_URL` se existir, senão `ROBO_DATABASE_URL` (o compose já repassa as duas).

## Ordem (cada passo só depois do anterior conferido)
1. **Criar as roles.** `node seguranca/gerar-roles.js` → abrir o `roles-com-senha.sql` no SQL Editor do Neon (branch de produção, role `neondb_owner`) e rodar. Não criar pelo console: role do console entra em `neon_superuser` (lê e grava tudo).
2. **Conferir.** Para cada URL do `urls.env`: `ROBO_DATABASE_URL=<url> node seguranca/inventario-neon.js` e olhar "Minhas permissões efetivas". Com a URL atual do robô também (o robô continua funcionando: só perdeu DELETE, que nunca teve, e UPDATE em id/versao/criado_em/data_criacao_documento).
3. **Painel.** `PAINEL_DATABASE_URL` no cofre hml (`... | bash cofre-juntar.sh hml`), publicar o painel (`%TEMP%/gesdoc-teste/publicar-painel.sh`, agora com `compose.hml.yml` e `server.js`) e conferir: aba Visão geral com estados do Neon, aba Pendências com o motivo da sincronização.
4. **Evilásio.** Mandar a `SINC_DATABASE_URL` por canal seguro (não por e-mail ou chat em texto aberto), ele troca no `.env`, roda uma sincronização e confirma. Perguntar antes: o serviço apaga linhas (DELETE) ou cria/altera tabelas ao subir (migração)? Se sim, ajustar o `roles.sql` (GRANT pontual) em vez de voltar ao owner.
5. **Trocar a senha do owner.** Só quando os passos 2 a 4 estiverem ok: no console do Neon, branch de produção → Roles → `neondb_owner` → Reset password. A URL nova do owner não vai para nenhum serviço nem arquivo: fica no gerenciador de senhas do Augusto, para migrações. Isso também resolve a pendência "rotacionar credenciais do Evilásio que apareceram no git" (conferir se havia outras: Factorial, e-mail).
6. **Trocar a senha do robô** (opcional, recomendado porque a URL está no OneDrive): `node seguranca/gerar-roles.js --so-robo` (só o `ALTER ROLE robo_atlas`), rodar no SQL Editor, atualizar o cofre hml, recriar os containers do Atlas e do painel, e mover o `env.robo` para fora do OneDrive (`%LOCALAPPDATA%\gesdoc-segredos\`).
7. **Allowlist de IP.** Console do Neon → Project settings → Network security → IP Allow (conferir se o plano atual tem; é recurso de plano pago). Liberar:
   - VPS Hostinger: `187.127.45.132` (e o IPv6 `2a02:4780:6e:1f86::1`, se o Neon aceitar)
   - máquina do Evilásio (pedir o IP fixo; se não tiver, a sincronização tem de ir para a VPS, que já é pendência)
   - este PC: IP muda; para testes locais, liberar na hora e tirar depois, ou testar pela VPS
   Ligar primeiro com a opção de valer só para a branch protegida (produção), o que deixa a branch "hml" do item 4 livre para testes.
8. **Depois.** Rodar o inventário de novo, guardar a saída em `%TEMP%` (não no repo) e apagar a pasta `gesdoc-segredos\<data>`.

## Se algo quebrar
- Robô ou painel com "permission denied": o inventário mostra o que falta; corrigir com um GRANT pontual como `neondb_owner`.
- Para desfazer tudo: `GRANT CONNECT, TEMPORARY ON DATABASE neondb TO PUBLIC; GRANT USAGE ON SCHEMA public TO PUBLIC; GRANT INSERT, UPDATE ON documentos TO robo_atlas;` e voltar a URL do serviço afetado (as roles novas podem ficar).
