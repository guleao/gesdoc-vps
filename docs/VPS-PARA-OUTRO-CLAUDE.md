# GesDoc: como a VPS está configurada (14/10/2026, 23h) e o teste a fazer no PC local

Para o Claude do outro PC. Leia inteiro antes de rodar qualquer coisa. Nada de senha, chave ou URL de banco aqui: elas ficam nas variáveis de usuário do Windows, no `env.robo` e no cofre da VPS. **Nunca imprima nenhuma delas.**

## 1. Acesso
- VPS Hostinger `srv2007033` · Ubuntu 24.04 · 4 vCPU, 15 GB · fuso America/Sao_Paulo · Python 3.12 · Docker.
- Firewall nega tudo, menos a rede do Tailscale (conta `stant-digital`, entrada pelo GitHub). Entrada pública só pelo Cloudflare Tunnel (container `cloudflared`).
- Entrar: `tailscale ssh augusto@100.103.196.93`. O `ssh`/`scp` direto falha na chave do IP. O `tailscale ssh` precisa de um `ssh.exe` no PATH: use o do Git (`C:\Program Files\Git\usr\bin`).
- PowerShell 5.1 + `tailscale ssh`: as aspas duplas internas somem (use aspas simples no comando remoto) e o pipe manda BOM + CRLF. No Git Bash funciona normal.
- O usuário `augusto` está no grupo `docker` (não precisa de sudo pra Docker). O `sudo` pede senha: o que precisar de sudo, quem roda é o Augusto.
- **Túnel do PC para um serviço interno da VPS** (testado; o `tailscale ssh` não aceita `-N -L`):
  ```bash
  ssh -o "ProxyCommand=tailscale nc %h %p" -o StrictHostKeyChecking=accept-new -N -L 13010:127.0.0.1:3010 augusto@100.103.196.93
  ```
  Com o túnel aberto, `http://127.0.0.1:13010` no PC é o Gotenberg da VPS.

## 2. Pastas
| caminho | o que é |
|---|---|
| `/opt/gesdoc` | repositório git da infra (dono augusto): `infra/`, `services/`, `workers/`, `docs/`, `migrations/`, `n8n/` (vazio), `backups/`, `data/` (fora do git) |
| `/opt/gesdoc/infra/secrets/hml.enc.env` | cofre SOPS (age; chave em `~/.config/sops/age/keys.txt`). Tem as credenciais do Atlas e do Bernhoeft, `ROBO_DATABASE_URL`, `ANTICAPTCHA_API_KEY` |
| `/opt/gesdoc/data/hml/pendencias-atlas/` | `out/` do robô Atlas (o `codigo.txt` do 2FA vai aqui) |
| `/opt/gesdoc/data/hml/pendencias-bernhoeft/` | `out/` do robô Bernhoeft (`pendencias.json`, `mudancas.txt`, `historico/`, `relatorios/`) |
| `/srv/gesdoc/downloads` | pasta dos PDFs da sincronização Factorial (chmod 700, dono `gesdoc`); criada em 14/10, ainda vazia de uso |
| `/opt/factorial` | home do usuário `gesdoc` (uid 999), criado em 14/10 pra sincronização do Evilásio; só o `gesdoc` lê |

Pôr segredo no cofre: na VPS, `printf 'CHAVE=valor\n' | bash ~/bernhoeft-robo/deploy/gesdoc/cofre-juntar.sh hml`. O script lê CHAVE=valor da entrada, faz backup, confere e troca; só imprime nomes. Não deixe o valor no histórico do shell: use `read -s`.

## 3. Containers no ar
| container | o que faz | porta |
|---|---|---|
| `gesdoc-pendencias-hml-atlas-1` | robô Atlas em loop: `node pendencias.js` a cada 60 min (coleta e grava no Neon) | — |
| `gesdoc-pendencias-hml-bernhoeft-1` | robô Bernhoeft: `node pendencias.js --loop` a cada 30 min. Logando (reCAPTCHA pela Anti-Captcha, ~45 s) | — |
| `gesdoc-pdf-hml-pdf-1` | Gotenberg 8 (une PDFs) | `127.0.0.1:3010`; na rede Docker `gesdoc-hml-pdf` como `http://pdf:3000` |
| `gesdoc-navegacao-hml-navegacao-1` | Playwright run-server (navegação compartilhada) | interna |
| `gesdoc-painel-hml-painel-1` + `-docker-1` | painel da automação + proxy do Docker só leitura | `http://100.103.196.93:3020` (só Tailscale); proxy em `127.0.0.1:3021` |
| `n8n-n8n-1`, `n8n-n8n-worker-1` | n8n 2.40.6 em modo fila. **Vazio: 0 fluxos, 0 credenciais.** Nada ligado nele | `127.0.0.1:5678` |
| `gesdoc-hml-postgres-1`, `gesdoc-hml-redis-1`, `gesdoc-prd-redis-1`, `postgresql-olpf-postgresql-1` | bancos da infra (não são o Neon) | internas / `127.0.0.1:5432` |

Compose de cada serviço em `/opt/gesdoc/services/<nome>/compose.hml.yml`. Os robôs sobem com o cofre:
`cd /opt/gesdoc && sops exec-env infra/secrets/hml.enc.env 'docker compose -f services/pendencias/compose.hml.yml up -d'`

## 4. Estado agora
- **Atlas na VPS: SEM LOGIN.** A cada hora ele pede o código de 2FA por e-mail e ninguém digita a tempo (30 min). O código pode ser digitado no painel (porta 3020) ou gravado em `/opt/gesdoc/data/hml/pendencias-atlas/codigo.txt`. São 8 letras e números. **Atenção:** o login na VPS pode derrubar a sessão do PC local (não testado).
- **Bernhoeft na VPS:** funcionando, 9 pendências "Não Entregue" (NIP GLOBAL). Sem permissão de upload nessa conta.
- **Neon** (tabela `documentos`): PENDENTE_ENVIO 124 · NAO_ENCONTRADO_FACTORIAL 13 · LOCALIZADO 12 · DIVERGENTE_FACTORIAL 9 · COMPOSTO 8 · AGUARDANDO_ASSINATURA 2. Os COMPOSTO/LOCALIZADO têm `caminho_origem` na máquina do Evilásio (os arquivos não estão na VPS nem neste PC).
- **Usuário do robô no Neon:** `robo_atlas` (SELECT/INSERT/UPDATE em `documentos`, só SELECT em `documento_regras`, sem DELETE). Conexão pelo driver HTTPS `@neondatabase/serverless` (no PC a porta 5432 pode estar bloqueada).
- **União de PDFs:** pelo guia do Evilásio (14/10), quem une é o serviço dele (`sincronizacao_factorial.py`, pypdf, repo privado `github.com/evilasioferreira/gestao-documental-equatorial`, `DEPLOY.md`). Ele ainda NÃO está instalado na VPS. O nosso `compor.js` (pelo Gotenberg) é reserva e grava no mesmo formato.
- **Envio ao Atlas:** não existe. O `enviar.js` só simula.
- **Webhooks:** nenhum configurado (`ALERT_WEBHOOK_URL` no Bernhoeft, `GESDOC_WEBHOOK_URL` no `ciclo.js` do Atlas).

## 5. Código e deploy (fonte única = pastas do PC)
- `atlas-robo/`: `pendencias.js` (coleta; grava no Neon no fim se houver conexão), `neon.js`, `compor.js`, `unir-pdfs.js`, `enviar.js` (simulação), `explorar-envio.js`, `ciclo.js`, `comum.js` (login, 2FA, `PROFILE_DIR`, `HEADLESS`).
- `bernhoeft-robo/deploy/subir-vps.ps1`: empacota os dois robôs (sem `profile/`, `out/`, `node_modules/`), manda pela VPS e roda `deploy/gesdoc/instalar-hml.sh`, que copia pra `/opt/gesdoc/services/...`, constrói as imagens e sobe tudo, incluindo o painel. Mudou código no PC → rodar o `subir-vps.ps1` de novo.
- A imagem do Atlas só leva `comum.js, login.js, pendencias.js, planilha.js, neon.js, unir-pdfs.js`. Pra usar `compor.js`/`enviar.js`/`ciclo.js` na VPS, incluí-los na linha `cp` do `instalar-hml.sh`.
- Imagem Bernhoeft: o Playwright do Python tem que ser da mesma versão do Node (1.63.0).

## 6. O teste a fazer no PC local (Atlas já logado aí)
Objetivo: pegar UMA pendência, montar o PDF, deixar no lugar certo, registrar no Neon e enviar ao Atlas.

1. **Conferir o ambiente sem imprimir valores:** `[bool]$env:ATLAS_USER`, `[bool]$env:ROBO_ENV_FILE` (ou `ROBO_DATABASE_URL`). Perfil logado em `atlas-robo/profile/`.
2. **Coletar:** `node pendencias.js`. Grava `out/atlas.db` e atualiza o Neon. O `enviar.js` precisa disso pra achar o `document_schedule_id`.
3. **Escolher a pendência:** de preferência doc_id 9 ou 10 (pacote) e de baixo risco. Ver no Neon: `id, doc_id, estado, caminho_origem`.
4. **Obter as partes** (TRCT, termo, comprovante...): da Factorial, pelo serviço do Evilásio ou baixando à mão. As partes nunca vão pro `demo.gotenberg.dev`.
5. **Unir e pôr no lugar certo:** abrir o túnel do item 1 e rodar
   `$env:GOTENBERG_URL='http://127.0.0.1:13010'; node compor.js --id <id> parte1.pdf parte2.pdf ...` (só simula). Se estiver certo, rodar de novo com `--gravar`.
   Isso salva em `<pasta>/factorial/<id>/doc<doc_id>_<cpf>_<MM-AAAA>.pdf` (pasta = `FACTORIAL_PASTA_DOWNLOAD` ou `out/downloads`, o mesmo formato do Evilásio) e grava no Neon COMPOSTO, caminho, tamanho e SHA-256. Ordem das partes: doc 8 aviso → recibo → comprovante; doc 9 TRCT → termo de quitação assinado → comprovante; doc 10 guia → comprovante.
6. **Conferir o envio:** `node enviar.js --id <id>` (lista e confere arquivo, tamanho e hash), depois `node enviar.js --id <id> --abrir 1`. Isso abre a tela `/document-schedule/<document_schedule_id>/general-information?resume=false` sem anexar nada.
7. **Envio real: ainda não existe código pra isso.** Pra o primeiro envio:
   - abrir a tela com janela;
   - anexar o arquivo e gravar as chamadas de rede do gateway (`gateway.atlasfacilities.com.br/api/v1/`);
   - **parar e pedir ao Augusto o "pode enviar" pra ESTE documento** antes de clicar "Salvar e enviar".
   Depois do envio: guardar a chamada de API, marcar no Neon (`enviado_em`) e só então implementar o `--enviar` no `enviar.js`, com limite por ciclo.

## 7. Regras (não negociáveis)
- Nada é enviado ao portal sem o "pode" do Augusto, documento por documento, até ele liberar.
- NUNCA clicar em "Exportar relatório" no Atlas (manda e-mail ao dono da conta).
- NUNCA mandar documento real ao `demo.gotenberg.dev`.
- Nunca imprimir URL do Neon, senha ou chave. Se alguém colar uma no chat, avisar pra trocar.
- O `neon.js` não muda `estado` de linha existente. Não reescrever o avanço do serviço do Evilásio.
- Mudança de código só no PC (fonte única) e depois `subir-vps.ps1`. Nada de editar direto na VPS.
- Arquivos com CPF (`out/`, downloads) não vão pra git, chat nem e-mail.

## 8. Depois do teste local, pra rodar na VPS
- Os PDFs prontos ficam em `/srv/gesdoc/downloads` (só o `gesdoc`). O container do Atlas vai precisar montar essa pasta, pelo menos pra ler.
- Incluir `compor.js`/`enviar.js`/`ciclo.js` na imagem do Atlas e trocar o comando do container pra `ciclo.js` quando o envio existir.
- Login do Atlas na VPS: digitar o código pelo painel.
