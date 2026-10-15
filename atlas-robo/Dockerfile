# Robô Atlas em contêiner (VPS). Somente leitura do portal.
# Node 22 é obrigatório (node:sqlite). O Chromium vem do Playwright, na versão do package-lock.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY comum.js login.js pendencias.js planilha.js neon.js unir-pdfs.js ./
# profile/ (sessão do Atlas) fica no volume /data; out/ (dados, codigo.txt) é montado de fora.
# Credenciais e ROBO_DATABASE_URL vêm de variáveis (cofre SOPS na VPS).
ENV HEADLESS=1 PROFILE_DIR=/data/profile PLANILHA_COPIA=0 CODIGO_MIN=30
VOLUME ["/data"]
# Roda uma leitura a cada INTERVALO_MIN minutos (padrão 60). Código 2 = login pendente (código do e-mail ou reCAPTCHA).
CMD ["sh", "-c", "while true; do node pendencias.js; rc=$?; echo \"[$(date +%H:%M:%S)] saída $rc; próxima leitura em ${INTERVALO_MIN:-60} min\"; i=0; while [ $i -lt $(( ${INTERVALO_MIN:-60} * 12 )) ] && [ ! -f out/rodar-agora ]; do sleep 5; i=$((i+1)); done; [ -f out/rodar-agora ] && rm -f out/rodar-agora && echo \"[$(date +%H:%M:%S)] leitura pedida pelo painel\"; done"]
