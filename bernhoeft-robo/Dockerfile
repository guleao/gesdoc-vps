# Robô Bernhoeft em container (para a stack Docker/Swarm). Somente leitura do portal.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Python + venv para o login automatico do reCAPTCHA (audio)
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
COPY requirements-captcha.txt ./
# O Playwright do Python TEM que ter a mesma versão da imagem/package.json: com outra versão, o "playwright install"
# dele apaga o Chromium que o Node usa (/ms-playwright) e o pendencias.js não abre (aconteceu com 1.64 em 14/10).
RUN python3 -m venv .venv-captcha && .venv-captcha/bin/pip install -q playwright==1.63.0 -r requirements-captcha.txt && .venv-captcha/bin/python -m playwright install chromium
COPY pendencias.js login.js login_auto.py ./
# profile/ (sessão) e out/ (dados) ficam em volumes; credenciais vêm de variáveis/secrets
ENV HEADLESS=1 PROFILE_DIR=/data/profile
VOLUME ["/data"]
CMD ["node", "pendencias.js", "--loop"]
