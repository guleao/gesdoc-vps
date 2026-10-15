# GesDoc (robôs de documentos + VPS)

## Visão geral
- **O que é:** gestão documental para a Equatorial. Dois robôs (Node + Playwright) leem pendências nos portais dos fornecedores, gravam no Neon (Postgres) e o objetivo é achar o documento (Factorial), unir os PDFs e enviar ao portal, sozinho. Dono: Augusto. Idioma: português.
- **Pastas:** `atlas-robo/` (Atlas/AFM, API + 2FA por e-mail, `neon.js`, `compor.js`, `enviar.js` só simula), `bernhoeft-robo/` (ContractWeb, reCAPTCHA por áudio em `login_auto.py`, `deploy/` da VPS, tem CLAUDE.md próprio), `docs/` (HANDOFF.md = LEIA PRIMEIRO, guia do Evilásio, auditoria da VPS, memórias antigas).
- **Como rodar:** `npm install` em cada robô; Atlas: `node pendencias.js` (coleta) e `node neon.js` (grava). Bernhoeft: `node pendencias.js`. Sem segredos no repo: ver HANDOFF.md seção 8 (variáveis de usuário, `env.robo`).
- **Como testar:** não há suíte; `compor.js` e `enviar.js` simulam sem `--gravar`. `deploy/gesdoc/services/navegacao/teste.js` é o teste de aceite do Playwright server.
- **Regras:** robôs SOMENTE LEITURA até o Augusto aprovar envio; Bernhoeft local e VPS sempre juntos (fonte única); nunca clicar "Exportar relatório" no Atlas; nunca mandar documento real ao demo.gotenberg.dev; nunca imprimir URL do Neon/senhas.
- **Não importado (de propósito):** `out/` dos robôs (CPFs e e-mail), `atlas.db`, sessões `.jsonl`, `bernhoeft-robo-vps.tgz`, `profile/`, `.env`. Continuam no zip em Downloads.

## Pendências
- [x] instalação na VPS executada em 14/10: navegação e Gotenberg (127.0.0.1:3010) no ar e saudáveis; imagens `gesdoc/pendencias-bernhoeft:hml` e `gesdoc/pendencias-atlas:hml` construídas
- [x] segredos dos dois robôs no cofre hml (14/10) e os dois containers no ar (`gesdoc-pendencias-hml-atlas-1`, `-bernhoeft-1`)
- [x] painel da automação (14/10): http://100.103.196.93:3020, só pelo Tailscale (`bernhoeft-robo/deploy/gesdoc/services/painel`, sobe no `instalar-hml.sh`); dá pra digitar o código de 2FA do Atlas nele. Em 15/10 ganhou as abas Pendências achadas, PDFs (visor) e Ao vivo (SSE `/api/ao-vivo`) e foi reorganizado para apresentar: nome "Automação de Documentos" (constante `NOME` na `pagina.html`; não usar "GesDoc" na tela), abas 1 Visão geral → 5 Ao vivo + Operação (controles, código do Atlas, serviços, pacotes), containers com nome amigável (`apelido()` no `server.js`); para atualizar só o painel: copiar os 4 arquivos para `/opt/gesdoc/services/painel` e `docker restart gesdoc-painel-hml-painel-1`
- [ ] falta: 1º login do Atlas na VPS (código de 2FA em `/opt/gesdoc/data/hml/pendencias-atlas/codigo.txt`)
- [x] reCAPTCHA do Bernhoeft na VPS: Anti-Captcha como reserva (chave `ANTICAPTCHA_API_KEY` no cofre hml, 14/10); áudio sempre dá rate limit no IP da Hostinger, Anti-Captcha resolve em ~45s
- [x] quem une os PDFs: o serviço do Evilásio (`sincronizacao_factorial.py`, pypdf), pelo guia de implantação de 14/10 (repo privado github.com/evilasioferreira/gestao-documental-equatorial, DEPLOY.md). `compor.js`/Gotenberg ficam de reserva
- [ ] falta: instalar a sincronização Factorial na VPS. Atenção: `/opt/gesdoc` já é o repo da infra (não usar o caminho do guia); o usuário `gesdoc` já existe com home `/opt/factorial` e `/srv/gesdoc/downloads` já foi criada (14/10 19:58); os passos 4.1/4.2 gravam no Neon de produção
- [x] `atlas-robo/ciclo.js` criado (coleta, Neon, envio simulado, trava, log em `out/ciclo.log`, webhook `GESDOC_WEBHOOK_URL`); falta a união de PDFs entrar nele (depende do Evilásio) e testar com `ROBO_DATABASE_URL`
- [ ] falta: envio real ao Atlas (chamada de API desconhecida; testar 1 doc com aprovação)
- [ ] falta: 2 tipos de documento sem par (Folha Analítica 8, Comprovante TRCT 5)
- [ ] falta: rotacionar credenciais do Evilásio que apareceram no git
- [ ] falta: Factorial → Bernhoeft. `documento_regras` já tem 6 docs com destino Bernhoeft (95 EPI, 112 Direção Defensiva, 113 Qualificação, 114 Integração, 115 Primeiros Socorros, 116 Treinamentos; chave CPF). Bloqueios: conta do prestador com permissão de envio; nenhuma dessas pendências aparece na conta atual (as 9 pendentes são documentos de empresa, que não vêm da Factorial); o robô Bernhoeft não grava no Neon; a sincronização do Evilásio só lê aba Atrasados (Atlas)
- [ ] não testado: imagem Docker do Atlas; reserva paga de captcha; upload Bernhoeft (conta sem permissão)

## Lições
- `neon.js` não pode reescrever `estado` em linhas existentes (apagava o avanço do serviço do Evilásio); corrigido em 14/10.
- reCAPTCHA por áudio exige Chrome com `locale='en-US'`.
- Postgres 5432 bloqueado no sandbox: usar o driver HTTPS `@neondatabase/serverless`.
- VPS neste PC: só `tailscale ssh` funciona (o ssh/scp comum falha na verificação de chave do IP) e ele precisa de `ssh.exe` no PATH: usar o do Git (`C:\Program Files\Git\usr\bin`). `subir-vps.ps1` já faz isso e acha os robôs ao lado dele (não mais em `Documents\`).
- Imagem Bernhoeft: o Playwright do Python tem que ter a MESMA versão do Node (1.63.0), senão o `playwright install` dele apaga o Chromium do Node (corrigido no Dockerfile em 14/10).
- PowerShell 5.1 → `tailscale ssh`: aspas duplas internas somem (usar aspas simples no comando remoto) e o pipe manda BOM + CRLF.
- reCAPTCHA do Bernhoeft na VPS: na 1ª tentativa deu `RecaptchaRateLimitError` (IP de datacenter); sem chave de serviço pago não há reserva.
- Pôr segredo no cofre: `... | bash cofre-juntar.sh hml` na VPS (`deploy/gesdoc/cofre-juntar.sh`: lê CHAVE=valor da entrada, faz backup, confere e troca; só imprime nomes).
