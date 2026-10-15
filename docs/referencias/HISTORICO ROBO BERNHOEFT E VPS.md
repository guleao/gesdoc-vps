# Histórico: robô Bernhoeft e VPS

Recuperado em 09/10/2026 a partir de 14 sessões do Claude Code (21/09 a 08/10), da memória do projeto e dos arquivos no PC. Nenhuma senha ou chave foi copiada para cá.

---

## 1. Linha do tempo

### 21/09: Plane do GesDoc
- O Plane do projeto **GESDOC — Automação Equatorial** foi reestruturado (93 itens).
- Foi gerado `Desktop\GESDOC-Plane-Estrutura-Completa.md`. Ele descreve o servidor como **CLI-01** (Ubuntu 22.04+, 4 vCPU, 8 GB, 100 GB), que o cliente deve fornecer (ponto focal: Javier / Ewerton), e a stack planejada: Docker Swarm, n8n, PostgreSQL, Redis, Traefik e workers.
- Você perguntou quais matrizes são usadas na Atlas e na Bernhoeft, para responder numa reunião.

### 01 e 02/10: acesso e auditoria da VPS `srv2007033`
- **Servidor:** `srv2007033.hstgr.cloud`, Hostinger, Ubuntu 24.04, 4 vCPU (AMD EPYC), 15 GB de RAM e 193 GB de disco. IP no Tailscale `100.103.196.93`, IP público `187.127.45.132`.
- **Acesso:** só pela rede Tailscale (tailnet `stant-digital.github`). O SSH por senha é recusado. Foi liberado o **Tailscale SSH**, trocando o modo `check` para `accept` na seção `ssh` do arquivo de políticas (ACL) do Tailscale. O usuário é `augusto`, que está no grupo `docker`.
- **O que roda nele:** n8n (fila + worker), dois PostgreSQL 17 (`gesdoc_prd` e `gesdoc_hml`), dois Redis e um Cloudflare Tunnel como entrada. Não tem portas abertas e o firewall nega tudo, menos o tailnet. Também há fail2ban, auditd, AppArmor, Lynis e atualizações automáticas.
- **Auditoria:** `C:\Users\Ryzen 7\auditoria-srv2007033-2026-10-01.md`, com 20 seções e 15 achados.
- **Feito no servidor:**
  - Backup novo cobrindo os dois bancos, os workflows e as credenciais do n8n e o volume do n8n, com retenção de 30 dias e verificação de integridade. A cópia externa (rclone para o Cloudflare R2) está pronta, mas falta a credencial do R2.
  - Fundação da Fase 3: núcleo Python (Redis Streams, travas, idempotência), dbmate para migrações, ADRs 0001 a 0003 e uma proposta de modelo de dados (F3.1) aplicada **só em homologação**. São 59 testes passando.
  - Correções: `.env` de produção com permissão `600` (F-9), swap de 2 GB (F-10), stack Traefik antiga arquivada (F-7), F-4 e parte do F-11.
  - Criado o usuário `evilasio`, igual ao `augusto`.
  - Commits no git **local do servidor** (`bf422b8`, `d2abad5`). Não existe repositório remoto.
- **Relatório da sessão:** `C:\Users\Ryzen 7\relatorio-sessao-2026-10-02.md`, com o que foi feito, como achar os commits e as pendências.

### 05/10: início do robô
- O Marcelo pediu para adiantar o robô que monitora a Atlas e a Bernhoeft.
- **Pesquisa:** a Bernhoeft tem API (ContractWeb v3), mas sem documentação pública de envio de documentos. Decisão: robô pela interface web, com Playwright, somente leitura.
- **Credenciais** guardadas nas variáveis de ambiente `BERNHOEFT_USER` e `BERNHOEFT_PASSWORD`.
- **Primeiro login:** você trocou as credenciais, e o login exigia reCAPTCHA. Você marcou o captcha à mão e a sessão ficou salva em `profile/`.
- **`monitor.js`:** lia o Relatório 012 a cada 10 minutos (menu em árvore: Relatórios > Documentos e Análise > 012).
- **Decisões suas:**
  - O documento vem do SharePoint pelo n8n.
  - Você sobe o documento pessoalmente, com a VPN ligada.
  - Cada automação n8n terá seu próprio robô.
- **Salvos:** o modelo do robô em `Desktop\robo-modelo` e o resumo em `Desktop\SESSÃO CONFIGURAÇÃO ROBO GESDOC - BERNHOEFT.md`.

### 06/10: `pendencias.js` e preparação da VPS
- **`pendencias.js`** substituiu o `monitor.js`, que lia só 5 de 18 registros. Ele:
  - lê Carregamento Trabalhista e Mobilização;
  - lista os pedidos do Relatório 012 com paginação;
  - baixa o último "Concluído" em xlsx e classifica cada documento: Não Entregue, Não Analisado ou Analisado;
  - compara com a leitura anterior (NOVA, SAIU, ALTERADA);
  - grava `out/pendencias.json`, `out/mudancas.txt` e `out/historico/`.
- **Descoberta:** a conta (Rodrigo Rocha) é do lado **contratante**. Ela recebe "Sem Permissão" em `/LinksContratante/CriarLink`, então o upload não é possível com ela.
- **Factorial:** foi feita uma coleção do Postman (paginação por `after_id`, 1.953 funcionários).
- **VPS (pergunta sua: "tem como pôr esse robô numa VPS?", Ubuntu):**
  - Modo servidor `HEADLESS=1`, caminho do Chrome por variável, webhook de alerta e o `login.js` para login manual.
  - `deploy/setup-ubuntu.sh`, que instala em `/opt/bernhoeft-robo`, cria o usuário `robo` e o arquivo `/etc/bernhoeft-robo.env`, com `bernhoeft-robo.service` e `bernhoeft-robo.timer` rodando a cada 30 minutos.
  - `CLAUDE.md` com a regra **"versão local e VPS sempre atualizadas juntas, com fonte única na pasta local"**.
  - Quando você disse "eu já tenho a VPS, procure no desktop", o Claude achou só o documento do Plane (CLI-01 bloqueado pelo cliente) e perguntou se a VPS era a da Hostinger ou a do cliente. **Ficou sem resposta.**

### 07/10: Docker e CapSolver
- Criados `Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore` e `.dockerignore`. Nada disso foi testado, porque o Docker não está instalado no PC.
- Você informou que **a empresa autorizou automatizar o captcha**.
- O CapSolver foi instalado (`capsolver-core`, `capsolver-mcp`) e registrado como MCP, mas a chave foi recusada (`ERROR_KEY_DENIED_ACCESS`).

### 08/10: captcha grátis, alertas e reserva paga
- O CapSolver foi abandonado. O **`playwright-recaptcha`** (desafio de áudio, grátis e sem chave) funcionou no login real em cerca de 8 a 10 s.
- **`login_auto.py`** foi integrado ao `pendencias.js`: quando a sessão expira, o robô faz o login sozinho, com até 4 tentativas. Correções:
  - o Chrome precisa abrir em `en-US`, senão o link do áudio não aparece;
  - o menu lateral abre recolhido em perfil novo;
  - o caminho do Chrome no `login.js` estava errado.
- **Alerta por webhook** (`ALERT_WEBHOOK_URL`) quando um documento passa a ser exigido ou sai da lista. Foi testado com um receptor local. **A URL real não foi configurada.**
- **Reserva paga** para quando o áudio falhar: 2Captcha, Anti-Captcha, CapMonster e CapSolver, na ordem definida por `CAPTCHA_FALLBACK`. Nenhum tem chave válida. O mais barato parece ser o CapMonster.
- **Última execução (08/10, 16:40):** login automático em 10 s. 39 documentos: 17 analisados, 13 não analisados e **9 não entregues**, todos da NIP GLOBAL LTDA. Os dados vêm do relatório de **25/09**.

---

## 2. Estado atual

**Robô (`Documents\bernhoeft-robo`)**
- Funciona no Windows: login automático, leitura, comparação e alerta (sem destino configurado).
- **Não faz upload**, porque a conta é de contratante.
- Não clica em SOLICITAR no Relatório 012, então os dados ficam presos em 25/09. Isso precisa do seu OK, porque cria um pedido no portal.
- Não está rodando em nenhum servidor.

**VPS**
- O robô **nunca foi instalado** em nenhuma VPS. Existem só os scripts de `deploy/` e o Docker, sem teste.
- **Ponto que ficou solto entre as sessões:** em 06/10 o Claude concluiu que "a VPS da GesDoc está bloqueada aguardando o cliente", com base no documento do Plane de 21/09. Mas a `srv2007033` (Hostinger), que você auditou em 01/10, **já é o servidor da GesDoc**: roda n8n e os bancos `gesdoc_prd` e `gesdoc_hml`. Ela é a candidata óbvia para o robô e tem recursos de sobra. Diferenças em relação ao que o `setup-ubuntu.sh` supõe:
  - roda Ubuntu 24.04, que é compatível;
  - o acesso é só por Tailscale SSH;
  - a stack é Docker (o Plane falava em Swarm);
  - não há portas abertas, então um webhook para o n8n seria interno.

---

## 3. Pendências

**Suas**
1. Confirmar se o robô vai na `srv2007033`, e se roda direto no Ubuntu ou em container ao lado do n8n.
2. Dar a URL do webhook de alerta (por exemplo, do n8n).
3. Dar o OK para o SOLICITAR no Relatório 012.
4. Conseguir uma conta de **contratada**, ou a permissão de upload, para mapear a tela de envio.
5. Passar a matriz de regras (documento → destino → periodicidade/validade).
6. **Trocar as credenciais que apareceram no chat:** a senha da Bernhoeft (05/10), a chave da API do Factorial (06/10) e a chave do CapSolver (07/10).

**Da VPS `srv2007033` (relatório de 02/10)**
- Copiar a chave do cofre SOPS/age (`~/.config/sops/age/keys.txt`) para fora do servidor. É o item mais grave.
- Criar o bucket e o token no Cloudflare R2 para a cópia externa do backup.
- Revisar o modelo de dados F3.1 (suposições S1 a S6).
- Criar um repositório remoto, porque hoje o git só existe no servidor.
- Decidir o CI/CD.
- Aplicar as atualizações pendentes numa janela de manutenção.
- Migrar os segredos de produção para o cofre.
- Resolver a configuração contraditória do SSH.

**Do robô na VPS, quando for instalar**
- Testar se o Google aceita o captcha de áudio no IP da Hostinger. Se recusar, usar o CapMonster como reserva.
- Testar o `setup-ubuntu.sh` ou o Docker.
- Ver se o portal exige a VPN que você usa para subir documentos.

---

## 4. Onde está cada coisa

| O quê | Onde |
|---|---|
| Robô (fonte única) | `C:\Users\Ryzen 7\Documents\bernhoeft-robo` |
| Regras do projeto | `bernhoeft-robo\CLAUDE.md` |
| Instalação na VPS | `bernhoeft-robo\deploy\` (`setup-ubuntu.sh`, `.service`, `.timer`) |
| Modelo antigo do robô | `Desktop\robo-modelo` |
| Resumo de 05/10 | `Desktop\SESSÃO CONFIGURAÇÃO ROBO GESDOC - BERNHOEFT.md` |
| Plane GesDoc | `Desktop\GESDOC-Plane-Estrutura-Completa.md` |
| Auditoria da VPS | `C:\Users\Ryzen 7\auditoria-srv2007033-2026-10-01.md` |
| Relatório da VPS | `C:\Users\Ryzen 7\relatorio-sessao-2026-10-02.md` |
| Projeto no servidor | `/opt/gesdoc` (docs em `/opt/gesdoc/docs/`, backups em `/opt/gesdoc/backups`) |

**Sessões de origem** (em `C:\Users\Ryzen 7\.claude\projects\C--Users-Ryzen-7\`):
- `b77b97f5` (21/09, Plane)
- `ed4c4942` (01–02/10, VPS)
- `3ad4593c`, `9b216f31`, `ceead505`, `ade08b71`, `255c9aa6`, `651fc28c` (05/10, início do robô)
- `67579c41` (06–07/10)
- `548ba875`, `d66bcc33` (07/10, CapSolver)
- `3b265cb7` (08/10)
