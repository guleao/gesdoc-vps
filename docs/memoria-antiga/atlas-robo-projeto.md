---
name: atlas-robo-projeto
description: "Robô somente leitura do portal Atlas (AFM Gestão, gestao.atlasfacilities.com.br), irmão do robô Bernhoeft; estado e próximos passos."
metadata:
  node_type: memory
  type: project
  originSessionId: 6106e772-754c-45d7-84b1-191ccc26a376
  modified: 2026-10-14T14:48:58.987Z
---

Pedido em 11/10/2026: "robô idêntico ao do Bernhoeft, mas no Atlas" (ver [[bernhoeft-robo-projeto]]). Pasta: `C:\Users\Ryzen 7\Documents\atlas-robo` (Node + Playwright, Chrome do sistema).

**O que se sabe do portal:** app Angular "afm-encargos-app"; login OIDC em `accounts.atlasfacilities.com.br/Account/Login` (campos `#Username`, `#Password`, botão `button[type=submit]` "ENTRAR"); API REST em `https://gateway.atlasfacilities.com.br/api/v1/` (`enc/`, `acc/`, ...) com token Bearer. A página de login carrega o reCAPTCHA mas não mostra widget (em 11/10); o robô espera a pessoa se ele aparecer. Rotas do app ligadas a documentos: `/dashboard/provider`, `/document-schedule`, `/documents`, `/employees/:id/required-documents`, `/reports/index`.

**Feito em 11/10/2026:** `comum.js` (abrir perfil, login automático, captura do token, `api()`), `login.js`, `explorar.js` (grava respostas do gateway em `out/explorar/api.json` + prints). Testado até a tela de login (sem credenciais).

**Login tem 2FA por e-mail:** após usuário/senha, o Atlas manda um código de 8 dígitos (tela "Verifique seu e-mail"). `informarCodigo()` em `comum.js` espera o código em `out/codigo.txt` (ou digitado na janela) por `CODIGO_MIN` min (padrão 15). Credenciais já definidas (escopo User). Em 12/10/2026 o código não chegou a tempo (a janela foi fechada, "Target page closed"). Em 13/10/2026 rodamos de novo com `CODIGO_MIN=60` e pedimos o código outra vez. Uma falha `ERR_NAME_NOT_RESOLVED` nesse dia foi passageira; bastou rodar de novo.

**13/10/2026 15:15:** o usuário digitou o código na janela e o login funcionou; o perfil ficou salvo. O `explorar.js` gravou 45 respostas em `out/explorar/api.json`. A conta é "NIP GLOBAL LTDA" (prestador) e a tela inicial é `/contracts/list`. Endpoints úteis: `POST enc/contracts/find` (items/count), `GET enc/providers/non-compliant`, `GET enc/document-reports/by-status/summary` (veio null). As rotas /document-schedule e /documents carregaram só o menu (rotas erradas; o certo é seguir os links do menu: DOCUMENTOS, Acompanhamento de entregas, Relatório de documentos...).

**13/10/2026, `pendencias.js` feito e testado.** A "planilha de pendências" é a tela Documentos > Acompanhamento de entregas (`/dashboard/provider`). A API é `POST enc/document-reports/provider` (corpo igual ao da tela, `secondary_status` 5 = todos). `main_status` 0 = Atrasados, 1 = Próximas entregas, 2 = Reprovados, 3 = Entregues, 4 = Todos. Os Reprovados também estão dentro de Atrasados. O script grava em SQLite (`out/atlas.db`, tabelas `coletas` e `pendencias`, view `pendencias_atuais`, via `node:sqlite`) e também em `out/pendencias.csv` e `.json`. Na 1ª coleta: 206 linhas, 27 nomes de documento distintos. **O botão "Exportar relatório" NÃO baixa arquivo: manda a planilha por e-mail ao dono da conta (Wellington, NIP GLOBAL).** Foi clicado uma vez num teste em 13/10; não clicar de novo. Depois que o perfil está salvo, o login não pede mais código.

Objetivo do usuário (áudios, 13/10/2026): o serviço 1 baixa as pendências (de preferência pela API), extrai o nome de cada documento e procura o documento pelo nome no Factorial ou em outro diretório. Começa como piloto que só lista, sem enviar nada. O serviço 2 ainda não foi definido.

**13/10/2026, Neon:** `neon.js` grava a última coleta na tabela `documentos` do Neon (banco neondb, usuário `robo_atlas`: SELECT/INSERT/UPDATE em documentos, só SELECT em documento_regras, sem CREATE/DELETE). A conexão vem de `ROBO_DATABASE_URL` ou `ROBO_ENV_FILE` (o arquivo do chefe está em `D:\Downloads\env.robo`); nunca imprimir a URL. O Postgres na porta 5432 é bloqueado pelo sandbox, então o robô usa o driver HTTPS `@neondatabase/serverless`. Cada linha precisa de um doc_id (FK): a tradução nome do Atlas -> doc_id está em `REGRAS` no neon.js. "Folha de Pagamento Mensal Analítica" e "Comprovante de Pagamento do TRCT" estão sem par (pulados) até alguém confirmar. Linhas do robô = `aba` preenchida, com `estado` PENDENTE_ENVIO. CPF/CNPJ vão só com dígitos (varchar 11/14). A 1ª gravação foi de 168 linhas (ids 43-210). As 41 linhas de teste antigas (ids 1-41) sumiram entre a leitura e a gravação; não foi o robô, que não tem DELETE.

**13/10/2026, junção de PDFs (pedido do usuário; um colega indicou o Gotenberg):** `unir-pdfs.js` une PDFs via `POST /forms/pdfengines/merge` e salva como `<nome do Atlas>.pdf`. O nome vem de `--nome` ou de `--pendencia <id do Neon>`. Os caracteres proibidos em nome de arquivo viram "-". As partes são enviadas como 001.pdf, 002.pdf... porque o Gotenberg une em ordem alfabética. O serviço da VPS está em `bernhoeft-robo/deploy/gesdoc/services/pdf/compose.hml.yml` (127.0.0.1:3010) e já entra no `instalar-hml.sh`, mas ainda não foi instalado. Não há Docker no PC. O teste foi feito em demo.gotenberg.dev só com PDFs falsos; nunca mandar documentos reais para o demo. Ainda não se sabe como os PDFs chegam da automação (pasta? n8n?).

**14/10/2026, deploy na VPS preparado mas não executado:**
- **O que foi feito:** o `atlas-robo/Dockerfile` (node:22 + Chromium do Playwright, loop a cada `INTERVALO_MIN`), `deploy/gesdoc/services/pendencias/compose.hml.yml` (os dois robôs), o `instalar-hml.sh` reescrito e `deploy/subir-vps.ps1`.
- **Por que não rodou:** o SSH do Claude não alcança a VPS (o Tailscale no PC mostrava "NoState"; porta 22 dá timeout). O usuário tem que rodar o subir-vps.ps1 ele mesmo.
- **O que falta no cofre `hml.enc.env`:** ATLAS_USER, ATLAS_PASSWORD e ROBO_DATABASE_URL.
- **Primeiro login do Atlas na VPS:** vai pedir o código do e-mail, que se grava em `/opt/gesdoc/data/hml/pendencias-atlas/codigo.txt`. O perfil do Chrome do Windows não serve no Linux.
- **Ainda não testado:** a imagem Docker do Atlas não foi construída em lugar nenhum, porque não há Docker no PC.

**Falta:** com os endpoints reais, escrever `pendencias.js` no mesmo molde do Bernhoeft (pendencias.json, mudancas.txt, historico/, `--loop`, webhook), `CLAUDE.md` e `deploy/`.

**How to apply:** checar `[bool]$env:ATLAS_USER` sem imprimir valores; recarregar das variáveis de usuário se o terminal for antigo.
