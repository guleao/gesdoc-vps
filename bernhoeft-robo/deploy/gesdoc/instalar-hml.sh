#!/usr/bin/env bash
# Instala no repositório /opt/gesdoc (HOMOLOGAÇÃO) os documentos e serviços feitos a partir dos robôs:
#   F3.25 docs/workers/padrao.md      F5.4 docs/spikes/captcha.md
#   F3.17 docs/contratos/bernhoeft.md  O2.1 docs/excecoes/bernhoeft.md
#   F3.24 services/navegacao           O2.6 services/pendencias (robôs Bernhoeft e Atlas, em loop)
#   services/pdf (Gotenberg: une os PDFs de cada pendência com o nome que o Atlas pede)
# Uso, na VPS, com as pastas dos dois robôs lado a lado (ex.: ~/bernhoeft-robo e ~/atlas-robo):
#   bash ~/bernhoeft-robo/deploy/gesdoc/instalar-hml.sh            # instala e sobe tudo
#   bash ~/bernhoeft-robo/deploy/gesdoc/instalar-hml.sh --commit   # idem e faz o commit no /opt/gesdoc
# Segredos no cofre (sops infra/secrets/hml.enc.env):
#   Bernhoeft: BERNHOEFT_USER, BERNHOEFT_PASSWORD (+ chaves *_API_KEY opcionais)
#   Atlas:     ATLAS_USER, ATLAS_PASSWORD, ROBO_DATABASE_URL (Neon)
# Robô sem os seus segredos no cofre não sobe (o resto sobe normalmente).
set -euo pipefail

REPO=/opt/gesdoc
ROBO="$(cd "$(dirname "$0")/../.." && pwd)"
ATLAS="${ATLAS_DIR:-$(dirname "$ROBO")/atlas-robo}"
PACOTE="$ROBO/deploy/gesdoc"
export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
SEGREDOS="$REPO/infra/secrets/hml.enc.env"
DADOS="$REPO/data/hml"   # saídas dos serviços (fora do git)
PW_IMG=mcr.microsoft.com/playwright:v1.63.0-noble
PEND="$REPO/services/pendencias"
log() { echo "[$(date +%H:%M:%S)] $*"; }
# tem VAR...: todas as variáveis existem e não estão vazias no cofre (nada é impresso).
tem() {
  local env
  env="$(sops -d "$SEGREDOS")" || return 1
  for v in "$@"; do printf '%s\n' "$env" | grep -q "^$v=." || return 1; done
}

[ -d "$ATLAS" ] || { log "Pasta do robô Atlas não encontrada em $ATLAS (defina ATLAS_DIR)."; exit 1; }

# 1) Documentos
log "Copiando documentos para $REPO/docs"
for d in workers spikes contratos excecoes; do
  mkdir -p "$REPO/docs/$d"
  cp "$PACOTE/docs/$d/"*.md "$REPO/docs/$d/"
done

# 2) Serviço de navegação (F3.24)
log "Subindo services/navegacao"
mkdir -p "$REPO/services/navegacao"
cp "$PACOTE/services/navegacao/"{compose.hml.yml,teste.js} "$REPO/services/navegacao/"
docker compose -f "$REPO/services/navegacao/compose.hml.yml" up -d
log "Aguardando o serviço ficar saudável"
for i in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' gesdoc-navegacao-hml-navegacao-1 2>/dev/null)" = healthy ] && break
  sleep 5
done
mkdir -p "$DADOS/pendencias-bernhoeft" "$DADOS/pendencias-atlas"
log "Teste de aceite da navegação (site público, screenshot e limite de sessões)"
docker run --rm --network gesdoc-hml-navegacao -v "$REPO/services/navegacao:/t:ro" -v "$DADOS/pendencias-bernhoeft:/out" "$PW_IMG" \
  sh -c 'cd /tmp && npm i -s --no-audit --no-fund playwright@1.63.0 >/dev/null && NODE_PATH=/tmp/node_modules MAX_SESSOES=3 node /t/teste.js' \
  || log "Teste da navegação falhou (seguindo com o resto)."

# 3) Serviço de PDF (Gotenberg): une os PDFs de cada pendência (cliente: unir-pdfs.js do robô Atlas)
log "Subindo services/pdf (Gotenberg, só em 127.0.0.1:3010)"
mkdir -p "$REPO/services/pdf"
cp "$PACOTE/services/pdf/compose.hml.yml" "$REPO/services/pdf/"
docker compose -f "$REPO/services/pdf/compose.hml.yml" up -d
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3010/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:3010/health >/dev/null && log "Gotenberg OK" || log "Gotenberg não respondeu em 127.0.0.1:3010"

# 4) Robôs de pendências (O2.6). O código vem das pastas dos robôs (fonte única); aqui só se copia e constrói.
log "Copiando e construindo o robô Bernhoeft (gesdoc/pendencias-bernhoeft:hml)"
mkdir -p "$PEND/bernhoeft" "$PEND/atlas"
cp "$ROBO"/{pendencias.js,login.js,login_auto.py,requirements-captcha.txt,package.json,package-lock.json,Dockerfile,.dockerignore} "$PEND/bernhoeft/"
docker build -q -t gesdoc/pendencias-bernhoeft:hml "$PEND/bernhoeft"
log "Copiando e construindo o robô Atlas (gesdoc/pendencias-atlas:hml)"
cp "$ATLAS"/{comum.js,login.js,pendencias.js,planilha.js,neon.js,unir-pdfs.js,enviar.js,factorial.js,robo.js,package.json,package-lock.json,Dockerfile,.dockerignore} "$PEND/atlas/"
docker build -q -t gesdoc/pendencias-atlas:hml "$PEND/atlas"
cp "$PACOTE/services/pendencias/compose.hml.yml" "$PEND/"

SERVICOS=""
if tem BERNHOEFT_USER BERNHOEFT_PASSWORD; then SERVICOS="$SERVICOS bernhoeft"
else log "Bernhoeft NÃO sobe: faltam BERNHOEFT_USER/BERNHOEFT_PASSWORD no cofre (sops $SEGREDOS)."; fi
if tem ATLAS_USER ATLAS_PASSWORD ROBO_DATABASE_URL; then SERVICOS="$SERVICOS atlas"
else log "Atlas NÃO sobe: faltam ATLAS_USER/ATLAS_PASSWORD/ROBO_DATABASE_URL no cofre (sops $SEGREDOS)."; fi

rc=0
if [ -n "$SERVICOS" ]; then
  log "Subindo robôs:$SERVICOS"
  sops exec-env "$SEGREDOS" "docker compose -f '$PEND/compose.hml.yml' up -d --force-recreate $SERVICOS"
  log "Aguardando a primeira leitura (2 min)"
  sleep 120
  docker compose -f "$PEND/compose.hml.yml" logs --tail 25 $SERVICOS || true
  case " $SERVICOS " in *" atlas "*)
    log "Atlas: se o log pedir o código do e-mail, grave-o (até 30 min) com:"
    log "  echo CODIGO > $DADOS/pendencias-atlas/codigo.txt" ;;
  esac
else
  log "Nenhum robô subiu (faltam segredos no cofre). Adicione com: sops $SEGREDOS e rode de novo."
  rc=4
fi

# 4b) Painel da automação (só pelo Tailscale, porta 3020)
log "Subindo services/painel (http://100.103.196.93:3020, só pelo Tailscale)"
mkdir -p "$REPO/services/painel" "$DADOS/pacotes-bernhoeft"
chmod 700 "$DADOS/pacotes-bernhoeft"
cp "$PACOTE/services/painel/"{compose.hml.yml,server.js,pacote.js,auto.js,pagina.html} "$REPO/services/painel/"
sops exec-env "$SEGREDOS" "docker compose -f '$REPO/services/painel/compose.hml.yml' up -d --force-recreate" \
  || log "Painel não subiu (seguindo)."

# 5) Commit (opcional). Só código e docs: dados, perfil e segredos ficam fora.
if [ "${1:-}" = "--commit" ]; then
  cd "$REPO"
  grep -qxF 'data/' .gitignore 2>/dev/null || echo 'data/' >> .gitignore
  git add .gitignore docs/workers docs/spikes docs/contratos docs/excecoes services/navegacao services/pdf services/pendencias services/painel
  git commit -m "Workers de navegação: padrão, captcha, robôs Bernhoeft e Atlas, serviço Playwright e serviço de PDF

F3.25 docs/workers/padrao.md; F5.4 docs/spikes/captcha.md; F3.17 docs/contratos/bernhoeft.md (leitura);
O2.1 docs/excecoes/bernhoeft.md (parte Bernhoeft); F3.24 services/navegacao;
O2.6 services/pendencias (Bernhoeft e Atlas em loop; Atlas grava no Neon); services/pdf (Gotenberg).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
  log "Commit feito: $(git log -1 --format=%h)"
fi
exit $rc
