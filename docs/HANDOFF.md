# GesDoc, robôs e VPS: contexto para continuar em outro PC

Gerado em 14/10/2026. Leia este arquivo primeiro; depois a pasta `claude/memory/` (notas de projeto) e `referencias/`.
O dono é Augusto Leão Soares (totalgames.guto@gmail.com). Idioma de trabalho: português.

## 1. O que é o projeto
GesDoc (gestão documental para a Equatorial). Robôs leem pendências de documentos nos portais dos fornecedores (Bernhoeft/ContractWeb e Atlas/AFM Gestão), gravam no Neon (Postgres), e o objetivo é achar o documento (Factorial, SharePoint), montar o arquivo (unir PDFs) e enviar ao portal, tudo automático, de tempos em tempos, sem gente.

Pessoas: Evilásio faz o serviço de sincronização com a Factorial (guia em `referencias/guia-evilasio-sincronizacao-factorial.html`). Wellington Ferreira da Silva é o dono da conta Atlas (NIP GLOBAL LTDA, prestador).

## 2. Pastas
- `projetos/atlas-robo`: robô Atlas (Node + Playwright). Arquivos: `comum.js` (login OIDC, 2FA por e-mail, token, api()), `login.js`, `pendencias.js` (coleta pela API para SQLite/CSV), `neon.js` (grava em `documentos` no Neon), `unir-pdfs.js` (Gotenberg), `compor.js`, `enviar.js` (simulação), `explorar*.js`, `planilha.js`, `Dockerfile`.
- `projetos/bernhoeft-robo`: robô Bernhoeft (Node + Python para captcha) e `deploy/` (setup-ubuntu.sh, `deploy/gesdoc/` com instalar-hml.sh, services/navegacao, services/pdf, services/pendencias, docs F3.25 etc., `deploy/subir-vps.ps1`). Tem `CLAUDE.md` com a regra: versão local e VPS sempre juntas, fonte única.
- `claude/memory`: memórias do Claude Code (atlas-robo-projeto, bernhoeft-robo-projeto, bernhoeft-robo-duas-versoes, ableton-plugins-layout).
- `claude/sessoes`: transcrições (.jsonl) de todas as sessões. Servem de histórico; não é preciso restaurá-las.
- `referencias`: guia do Evilásio, artefato de integração, histórico do robô Bernhoeft e da VPS, auditoria do servidor (01/10) e relatório da sessão (02/10).

NÃO estão no pacote (de propósito, são segredos ou sessões logadas): `profile/` (sessão do Chrome em cada robô), `postman/`, `.env`, o arquivo `env.robo`, as variáveis de ambiente. Veja a seção 8.

## 3. Fluxo e estado em 14/10/2026
1. **Capturar** (funciona, local): `node pendencias.js` lê `POST enc/document-reports/provider` (Atlas) e grava `out/atlas.db`; `node neon.js` grava na tabela `documentos` do Neon (aba preenchida, estado PENDENTE_ENVIO só em linha nova).
2. **Sincronizar** (serviço do Evilásio, já rodou): valida CPF na Factorial, acha e baixa arquivos, grava estado/caminho/tamanho/SHA-256. Estados: COMPOSTO, LOCALIZADO, NAO_ENCONTRADO_FACTORIAL, AGUARDANDO_ASSINATURA, DIVERGENTE_FACTORIAL, ERRO_COMPOSICAO.
3. **Unir PDFs**: `compor.js` (mesmo nome e pasta da sincronização: `factorial/<id>/doc<doc_id>_<cpf>_<MM-AAAA>.pdf`; grava COMPOSTO, caminho, tamanho, hash; só simula sem `--gravar`). Ordem: doc 8 aviso, recibo, comprovante; doc 9 TRCT, termo de quitação assinado, comprovante; doc 10 guia, comprovante. Decisão em aberto: o serviço do Evilásio também compõe (8 linhas COMPOSTO feitas por ele). Combinar com ele onde ficam as partes baixadas e que ele desligue a composição, para os dois não gravarem na mesma linha.
4. **Enviar ao Atlas** (simulação pronta, envio real NÃO existe): `enviar.js` lê COMPOSTO/LOCALIZADO do Neon, acha o `document_schedule_id` na última coleta local, confere arquivo (extensão .pdf/.zip, tamanho, SHA-256) e, com `--abrir N`, abre a tela de envio sem anexar. Tela: `/document-schedule/<document_schedule_id>/general-information?resume=false` (campo de arquivo, "Observações do fornecedor", botão "Salvar e enviar" desabilitado até anexar). A chamada de API do envio ainda é desconhecida (só aparece ao enviar de verdade). Plano: testar com um documento de baixo risco, com aprovação do Augusto, capturar a chamada, e só depois automatizar com limite por ciclo.
5. **Automação**: `ciclo.js` (coletar, gravar no Neon, unir, enviar, com trava, log e aviso por webhook) está proposto e NÃO foi criado.

Correção feita em 14/10: `neon.js` reescrevia `estado` para PENDENTE_ENVIO nas linhas existentes, apagando o avanço do serviço do Evilásio. Agora o UPDATE não toca em `estado`.

Neon em 14/10: PENDENTE_ENVIO 124; NAO_ENCONTRADO_FACTORIAL 13; LOCALIZADO 12; DIVERGENTE_FACTORIAL 9; COMPOSTO 8; AGUARDANDO_ASSINATURA 2. `documentos` tem colunas: id, doc_id, colaborador_id, competencia, estado, versao, hash_arquivo, tamanho_bytes, caminho_origem, data_criacao_documento, criado_em, atualizado_em, prazo_envio, cliente, unidade, nome, categoria, aba, situacao, funcionario, cpf, tipo, grupo, numero_pedido, cnpj_filial, qtd_docs, enviado_em, validado_em, validade, critico. Usuário do robô: `robo_atlas` (SELECT/INSERT/UPDATE em documentos, só SELECT em documento_regras, sem CREATE/DELETE). Documentos sem par e pulados: "Folha de Pagamento Mensal Analítica" (8), "Comprovante de Pagamento do TRCT" (5).

## 4. Atlas (detalhes úteis)
- Portal `https://gestao.atlasfacilities.com.br` (Angular); login OIDC em `accounts.atlasfacilities.com.br`; API `https://gateway.atlasfacilities.com.br/api/v1/` com Bearer.
- Login tem 2FA por e-mail (8 dígitos). O robô espera o código em `out/codigo.txt` ou digitado na janela (`CODIGO_MIN`, padrão 15). Com o perfil salvo em `profile/`, não pede de novo até a sessão expirar. Uma janela de boas-vindas aparece ao abrir; fechar pelo "Close".
- Planilha de pendências = Documentos > Acompanhamento de entregas (`/dashboard/provider`); API `POST enc/document-reports/provider` (`main_status` 0 Atrasados, 1 Próximas, 2 Reprovados, 3 Entregues, 4 Todos; `secondary_status` 5 = todos). Reprovados também estão dentro de Atrasados.
- NUNCA clicar "Exportar relatório" (manda e-mail ao dono da conta; já foi clicado uma vez em teste).
- Conta: Wellington Ferreira da Silva, NIP GLOBAL LTDA, tela inicial `/contracts/list`.

## 5. Bernhoeft (resumo; detalhe em `claude/memory/bernhoeft-robo-projeto.md`)
Portal ContractWeb (`newcontract.contractweb.com.br`), sem API de envio. Login com reCAPTCHA resolvido por áudio grátis (`playwright-recaptcha`, venv `.venv-captcha`, não incluído: recriar com `requirements-captcha.txt`); serviços pagos são fallback (sem saldo/chave inválida em 09/10). Conta atual é do lado contratante e não tem permissão de upload. `pendencias.js` lê o relatório 012 (xlsx) e compara com a leitura anterior.

## 6. VPS
- Servidor `srv2007033.hstgr.cloud` (Hostinger, Ubuntu 24.04, 4 vCPU, 15 GB; n8n, Postgres gesdoc_prd/hml, Redis, Cloudflare Tunnel). Acesso só por Tailscale SSH como `augusto` no IP `100.103.196.93` (o nome do host falha na verificação de chave; o IP funciona).
- Repositório da VPS: `/opt/gesdoc`. Cofre de segredos SOPS: `hml.enc.env` (faltam ATLAS_USER, ATLAS_PASSWORD e ROBO_DATABASE_URL). Dados do robô Atlas: `/opt/gesdoc/data/hml/pendencias-atlas/` (código de 2FA em `codigo.txt`).
- Instalação: no PC, `powershell -ExecutionPolicy Bypass -File deploy\subir-vps.ps1` (empacota os dois robôs sem profile/out/node_modules, envia por scp e roda `deploy/gesdoc/instalar-hml.sh`). Gotenberg em 127.0.0.1:3010. A imagem Docker do Atlas nunca foi construída (sem Docker no PC).
- ESTADO: instalação NÃO executada. Em 14/10 o Tailscale do PC estava deslogado ("You are logged out"), então a porta 22 dava timeout. Passos: `tailscale up` (login no navegador), pôr os segredos no cofre, rodar `subir-vps.ps1`, gravar o código de 2FA do Atlas em `codigo.txt` no primeiro login. O Claude Code costuma ter SSH à VPS negado pelo classificador de permissões; o Augusto pode precisar rodar com `!` ou liberar.
- Credenciais do Evilásio apareceram no histórico do git: o guia manda rotacionar antes de produção.

## 8. O que precisa ser reconfigurado no PC novo
Variáveis de ambiente de usuário: `ATLAS_USER`, `ATLAS_PASSWORD`, `BERNHOEFT_USER`, `BERNHOEFT_PASSWORD`, `CAPSOLVER_API_KEY`, `ANTICAPTCHA_API_KEY`, `TWOCAPTCHA_API_KEY`. Arquivo `env.robo` (tem `ROBO_DATABASE_URL`; antes em `D:\Downloads\env.robo`, apontado por `ROBO_ENV_FILE`). Perfis do Chrome (`profile/`): fazer login de novo (Atlas pede código por e-mail; Bernhoeft tem captcha). Conferir com `[bool]$env:ATLAS_USER`, sem imprimir valores; se as variáveis não aparecerem, fechar e reabrir o Claude Code por completo.
Transferir segredos por um canal seguro (gerenciador de senhas, pendrive seu); não por e-mail nem chat.

## 9. Regras e preferências do Augusto
- Português. Direto, sem rodeios.
- Bernhoeft: manter versão local (Windows) e VPS sempre juntas, mudança feita uma vez só (ver `bernhoeft-robo-duas-versoes`).
- Robôs somente leitura até o Augusto aprovar envio. Nunca mandar documentos reais ao `demo.gotenberg.dev` (só PDFs falsos).
- Nunca imprimir URL do Neon, senhas ou chaves. Se uma senha for colada no chat, avisar para trocar.
- Docker não existe no PC; o Postgres 5432 é bloqueado pelo sandbox, por isso o robô usa o driver HTTPS `@neondatabase/serverless`.
- Ableton e plugins estão no D: desde 09/10/2026 (assunto à parte, ver memória `ableton-plugins-layout`).

## 10. Próximos passos
1. `tailscale up`, segredos no cofre, `subir-vps.ps1`, código de 2FA do Atlas; conferir os containers na VPS.
2. Combinar com o Evilásio: onde ficam as partes baixadas e quem une os PDFs.
3. Criar `ciclo.js` e ligar `compor.js` e `enviar.js` a ele, ainda em simulação.
4. Testar um envio real ao Atlas com aprovação, capturar a chamada de API, implementar `--enviar` com limite por ciclo.
5. Resolver os dois documentos sem par.
