# Sincronização Factorial do Evilásio (código em app/, copiado do repo privado num commit fixo: ver app/VERSAO) + rodar.py.
# Construída pelo publicar-sincronizacao.sh: docker build -t gesdoc/sincronizacao-factorial:hml /opt/gesdoc/services/sincronizacao
FROM python:3.12-slim
WORKDIR /app
COPY app/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ /app/
COPY rodar.py /app/rodar.py
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 FACTORIAL_PASTA_DOWNLOAD=/srv/gesdoc/downloads SINC_OUT=/out
# 1000 = mesmo dono do painel (lê os PDFs em /opt/gesdoc/data/hml, montado só leitura)
USER 1000:1000
ENTRYPOINT ["python", "rodar.py"]
