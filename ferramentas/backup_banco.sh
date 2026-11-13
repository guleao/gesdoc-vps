#!/usr/bin/env bash
# Backup diário do banco (pg_dump), independente do histórico do Neon.
#
# Na VPS, pelo cofre (BACKUP_DATABASE_URL = conexão com permissão de leitura em todas as tabelas):
#   30 3 * * * cd /opt/gesdoc && sops exec-env infra/secrets/hml.enc.env '/opt/gesdoc/ferramentas/backup_banco.sh' >> /opt/gesdoc/data/hml/backup.log 2>&1
#
# Requer pg_dump 18 (mesma versão do servidor Neon): apt install postgresql-client-18
#
# Variáveis:
#   BACKUP_DATABASE_URL  conexão (obrigatória; vem do cofre, nunca escrita em arquivo)
#   BACKUP_PASTA         onde guardar os dumps (padrão: /opt/gesdoc/data/backups)
#   BACKUP_DIAS          quantos dias manter (padrão: 14)
#   BACKUP_COPIA_CMD     comando para copiar o dump para fora da VPS; {} = arquivo
#                        (ex.: "rclone copy --no-traverse {} remoto:gesdoc-backups")
set -euo pipefail

: "${BACKUP_DATABASE_URL:?defina BACKUP_DATABASE_URL (pelo cofre: sops exec-env)}"
PASTA="${BACKUP_PASTA:-/opt/gesdoc/data/backups}"
DIAS="${BACKUP_DIAS:-14}"
ARQUIVO="$PASTA/gesdoc_$(date +%Y%m%d_%H%M).dump"

mkdir -p "$PASTA"
chmod 700 "$PASTA"

pg_dump --format=custom --no-owner --no-privileges --file="$ARQUIVO" "$BACKUP_DATABASE_URL"
chmod 600 "$ARQUIVO"

# o dump só vale se puder ser lido de volta
pg_restore --list "$ARQUIVO" > /dev/null

if [ -n "${BACKUP_COPIA_CMD:-}" ]; then
  ${BACKUP_COPIA_CMD//\{\}/$ARQUIVO}
fi

find "$PASTA" -name 'gesdoc_*.dump' -mtime +"$DIAS" -delete
echo "$(date '+%F %T') backup ok: $ARQUIVO ($(du -h "$ARQUIVO" | cut -f1))"
