# Robô Atlas em contêiner (VPS). Somente leitura do portal.
# Node 22 é obrigatório (node:sqlite). O Chromium vem do Playwright, na versão do package-lock.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY comum.js login.js pendencias.js planilha.js neon.js unir-pdfs.js enviar.js factorial.js sharepoint.js robo.js ./
# profile/ (sessão do Atlas) fica no volume /data; out/ (dados, codigo.txt) é montado de fora.
# Credenciais e ROBO_DATABASE_URL vêm de variáveis (cofre SOPS na VPS).
ENV HEADLESS=1 PROFILE_DIR=/data/profile PLANILHA_COPIA=0 CODIGO_MIN=30
VOLUME ["/data"]
# robo.js: uma fila só. Coleta a cada INTERVALO_MIN (padrão 60; out/rodar-agora = na hora), busca na Factorial, lista de envio,
# pedidos do painel (verificar/enviar) e, se o botão "envio automático" do painel estiver ligado, o envio. Ver robo.js.
CMD ["node", "robo.js"]
