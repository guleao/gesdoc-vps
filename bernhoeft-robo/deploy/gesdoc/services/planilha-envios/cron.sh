#!/bin/bash
# Planilha "USO INTENSIVO ASSISTIDO" agendada (crontab do augusto, horário de Brasília):
#   0 0 * * * /opt/gesdoc/services/planilha-envios/cron.sh
# Gera a planilha de ontem em /opt/gesdoc/data/hml/planilhas-envios. Só lê os logs dos robôs; sem segredo, sem rede.
# Log em /opt/gesdoc/data/hml/planilhas-envios/planilha.log.
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
H=/opt/gesdoc/data/hml/planilhas-envios
mkdir -p "$H"
cd /opt/gesdoc || exit 1
{
  echo "== $(date '+%F %T')"
  docker compose -f services/planilha-envios/compose.hml.yml run --rm -T planilha "$@" 2>&1 \
    | grep -v '^ *Container\|Creating\|Created'
  echo "== fim $(date '+%T') (saída ${PIPESTATUS[0]})"
} >> "$H/planilha.log"
