#!/usr/bin/env bash
# Instala o robô Bernhoeft numa VPS Ubuntu 22.04/24.04. Rodar como root:  sudo bash deploy/setup-ubuntu.sh
set -euo pipefail

APP_USER=robo
APP_DIR=/opt/bernhoeft-robo
ORIGEM="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y curl ca-certificates xauth python3 python3-venv
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
# Copia só o código (nunca profile/ nem out/ do PC)
cp "$ORIGEM"/{pendencias.js,mobilizacao.js,comentarios.json,login.js,login_auto.py,requirements-captcha.txt,package.json,package-lock.json} "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci --omit=dev && npx playwright install chromium"
npx --prefix "$APP_DIR" playwright install-deps chromium

# Login automatico do reCAPTCHA (solver por audio, sem servico pago): venv Python com Playwright + FFmpeg embutido
sudo -u "$APP_USER" bash -c "cd $APP_DIR && python3 -m venv .venv-captcha && .venv-captcha/bin/pip install -q playwright==1.63.0 -r requirements-captcha.txt && .venv-captcha/bin/python -m playwright install chromium"

# Credenciais: arquivo só legível pelo root/serviço
if [ ! -f /etc/bernhoeft-robo.env ]; then
  cat > /etc/bernhoeft-robo.env <<'ENV'
BERNHOEFT_USER=
BERNHOEFT_PASSWORD=
HEADLESS=1
# Reserva paga do captcha (opcional; usada só se o audio falhar):
# TWOCAPTCHA_API_KEY=
# ANTICAPTCHA_API_KEY=
# CAPMONSTER_API_KEY=
# CAPSOLVER_API_KEY=
# ALERT_WEBHOOK_URL=https://seu-n8n/webhook/bernhoeft-alerta
ENV
fi
chmod 600 /etc/bernhoeft-robo.env

cp "$ORIGEM"/deploy/bernhoeft-robo.service /etc/systemd/system/
cp "$ORIGEM"/deploy/bernhoeft-robo.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now bernhoeft-robo.timer

echo
echo "Pronto. Próximos passos:"
echo " 1) Edite /etc/bernhoeft-robo.env com BERNHOEFT_USER e BERNHOEFT_PASSWORD"
echo " 2) Teste o login automatico (reCAPTCHA por audio):"
echo "      cd $APP_DIR && set -a && . /etc/bernhoeft-robo.env && set +a && sudo -u $APP_USER -E HEADLESS=1 .venv-captcha/bin/python login_auto.py"
echo "    Se falhar (o Google pode recusar o audio para IP de datacenter), use o login manual: do seu PC, ssh -X $APP_USER@IP_DA_VPS  e rode:"
echo "      cd $APP_DIR && set -a && . /etc/bernhoeft-robo.env && set +a && HEADLESS=0 node login.js"
echo " 3) Teste do robo: sudo systemctl start bernhoeft-robo.service && journalctl -u bernhoeft-robo -n 50"
