# Robô Bernhoeft (ContractWeb)

Robô em Node + Playwright que lê o portal Bernhoeft (`https://newcontract.contractweb.com.br/`) e lista documentos pendentes. **Somente leitura**: não envia documentos nem clica em SOLICITAR sem o usuário pedir.

## Regra principal: duas versões, sempre juntas
- **Local (Windows):** esta pasta, `Documents\bernhoeft-robo`. É onde o usuário testa.
- **VPS (Ubuntu):** instalada em `/opt/bernhoeft-robo` pelo `deploy/setup-ubuntu.sh`, a partir DESTA mesma pasta.
- Toda mudança no código deve funcionar nas duas e ser feita uma vez só, aqui (fonte única). Nunca criar código só para a VPS.
- Ao mudar `pendencias.js`, `login.js`, `package.json` ou `deploy/`, conferir os dois ambientes: o que depende do sistema (caminho do Chrome, headless, `--no-sandbox`) fica em variáveis de ambiente, com padrão que funciona no Windows.
- Se adicionar um arquivo que o robô precisa para rodar, incluí-lo também na linha `cp` do `deploy/setup-ubuntu.sh`.
- Avisar o usuário sempre que a VPS precisar ser reatualizada (copiar arquivos e `sudo bash deploy/setup-ubuntu.sh`).

## Arquivos
- `pendencias.js`: leitura principal (competências, relatório 012, xlsx, comparação com a leitura anterior). Flags: `--loop`, `--concluidos`.
- `login_auto.py`: login automático (reCAPTCHA v2 resolvido primeiro pelo áudio com `playwright-recaptcha`, grátis; se falhar, pelos serviços pagos que tiverem chave). O `pendencias.js` chama quando a sessão expira (fecha o contexto, roda o Python, reabre). Código de saída 3 = falhou.
- `login.js`: login manual (fallback) para renovar a sessão.
- `requirements-captcha.txt` + `.venv-captcha/`: dependências Python do login automático (o venv não é versionado).
- `captcha_test_audio.py`, `captcha_test_portal.py`: testes do solver (página demo do Google e login real).
- `Dockerfile`, `docker-compose.yml`, `.env.example`: container para a stack Docker/Swarm (não testado: Docker não está instalado no PC local; a tag da imagem Playwright deve acompanhar a versão do `playwright` no `package.json`).
- `monitor.js`, `spike.js`, `diag.js`: versões antigas/diagnóstico (o `monitor.js` está aposentado, substituído por `pendencias.js`). `explorar*.js`: exploração somente leitura de telas.
- `deploy/`: `setup-ubuntu.sh`, `bernhoeft-robo.service`, `bernhoeft-robo.timer` (roda a cada 30 min, código de saída 2 = sessão expirada).
- `deploy/gesdoc/`: pacote para o repositório `/opt/gesdoc` da VPS (homologação). Docs `docs/workers/padrao.md` (F3.25), `docs/spikes/captcha.md` (F5.4), `docs/contratos/bernhoeft.md` (F3.17, só leitura), `docs/excecoes/bernhoeft.md` (O2.1, parte Bernhoeft), `services/navegacao/` (F3.24: Playwright `run-server` com `--max-clients`, teste de aceite `teste.js` aprovado localmente em 09/10), `services/pdf/` (Gotenberg 8 em 127.0.0.1:3010, une os PDFs de cada pendência; o cliente é o `unir-pdfs.js` do robô Atlas) e `instalar-hml.sh`, que copia tudo, sobe a navegação, constrói a imagem deste robô em `services/pendencias/bernhoeft` (O2.6) e faz uma leitura com as credenciais do cofre SOPS. O código do leitor continua vindo DESTA pasta (o script copia).
- `deploy/subir-vps.ps1`: roda no PC e sobe tudo para a VPS. Empacota `bernhoeft-robo` e `atlas-robo` só com código (sem profile/, out/, node_modules/, postman/), envia por scp para augusto@100.103.196.93 (Tailscale) e roda o `instalar-hml.sh`. O instalador sobe a navegação, o PDF (Gotenberg) e `services/pendencias/compose.hml.yml`: os dois robôs em loop (Bernhoeft a cada 30 min, Atlas a cada 60 min, gravando no Neon). Cada robô só sobe se os seus segredos estiverem no cofre SOPS.
- `postman/`: coleção da API do Factorial.
- `profile/` (sessão salva) e `out/` (dados coletados): sensíveis, nunca versionar nem compartilhar.

## Variáveis de ambiente
- `BERNHOEFT_USER`, `BERNHOEFT_PASSWORD`: credenciais. Nunca no código nem no chat. No Windows ficam nas variáveis de usuário (recarregar com `[Environment]::GetEnvironmentVariable(..., 'User')`); na VPS em `/etc/bernhoeft-robo.env` (chmod 600).
- `AUTO_LOGIN=0` (desliga o login automático), `PYTHON_BIN` (padrão: `.venv-captcha`), `TENTATIVAS` (padrão 4).
- `HEADLESS=1`: sem janela; se a sessão cair, avisa e sai com código 2.
- `CHROME_PATH`, `PROFILE_DIR`, `INTERVALO_MIN`, `ALERT_WEBHOOK_URL` (opcionais). O webhook recebe POST JSON `{texto, tipo, exigidos[], resolvidas[], coletado_em}`: `tipo: "documentos_requeridos"` quando o portal passa a exigir um documento novo (ou um sai da lista; na 1ª leitura manda o resumo do que já está pendente); também avisa sessão expirada/login automático falho.

## Cuidados
- reCAPTCHA no login: a empresa autorizou automatizar (usuário, 07/10/2026). Resolvido em 08/10/2026 pelo áudio (`login_auto.py`), grátis. Regras: o Chrome precisa de `locale='en-US'` (em português o desafio não mostra o link do MP3 e dá timeout; vale para `pendencias.js` e `login_auto.py`); depende do endpoint de voz do Google, então é intermitente (por isso 4 tentativas com pausa) e pode ser recusado em IP de datacenter (testar na VPS). Se o áudio falhar, `login_auto.py` tenta os serviços pagos que tiverem chave em variável (`TWOCAPTCHA_API_KEY`, `ANTICAPTCHA_API_KEY`, `CAPMONSTER_API_KEY`, `CAPSOLVER_API_KEY`; ordem em `CAPTCHA_FALLBACK`), todos pelo mesmo protocolo createTask/getTaskResult; sem chave, o serviço é pulado. Na VPS (IP da Hostinger) o áudio sempre dá `RecaptchaRateLimitError`; a Anti-Captcha (chave no cofre hml) resolveu em ~45s e logou em 14/10/2026. `AUTO_LOGIN=0` desliga e volta ao manual. CapSolver foi abandonado (a chave dava ERROR_KEY_DENIED_ACCESS). Python 3.13+ precisa dos pacotes `standard-aifc` etc. (já em `requirements-captcha.txt`).
- Antes de rodar no Windows: `[bool]$env:BERNHOEFT_USER` (sem imprimir valores).
- O usuário atual (contratante) não tem permissão de upload (`/LinksContratante/CriarLink` dá "Sem Permissão") e as telas de Carregamento estão vazias. Upload ainda não implementado: precisa de conta com acesso ou do fluxo gravado.
- Chaves de API coladas no chat (Factorial) devem ser trocadas; não usar em arquivos.
- Não usar o MCP plane-uxnaut neste projeto.
