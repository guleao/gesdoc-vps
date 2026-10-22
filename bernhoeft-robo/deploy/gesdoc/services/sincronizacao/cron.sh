#!/bin/bash
# Sincronização Factorial agendada (crontab do augusto, horário de Brasília):
#   0 7-19/2 * * * /opt/gesdoc/services/sincronizacao/cron.sh
# Grava no Neon com SINC_DATABASE_URL (role sinc_factorial). Não envia nada a portal nenhum.
# Log em /opt/gesdoc/data/hml/sincronizacao/sincronizacao.log (CPF mascarado). O flock do rodar.py impede rodar duas vezes.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
H=/opt/gesdoc/data/hml/sincronizacao
cd /opt/gesdoc || exit 1
{
  echo "== $(date '+%F %T')"
  sops exec-env infra/secrets/hml.enc.env \
    'docker compose -f services/sincronizacao/compose.hml.yml run --rm -T sincronizacao --gravar' 2>&1 \
    | grep -v '^ *Container\|Creating\|Created' \
    | sed -E 's/\b[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}\b/<cpf>/g'
  echo "== fim $(date '+%T') (saída ${PIPESTATUS[0]})"
} >> "$H/sincronizacao.log"
