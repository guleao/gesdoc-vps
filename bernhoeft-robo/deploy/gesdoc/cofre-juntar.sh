#!/usr/bin/env bash
# Junta ao cofre SOPS as linhas CHAVE=valor recebidas pela entrada padrão. Nada é impresso além dos NOMES.
# Chave que já existe no cofre é substituída; as outras ficam como estão. Backup do cofre cifrado em ~/.
# Uso (na VPS):  ... | bash cofre-juntar.sh [hml|prd]      (padrão hml)
set -euo pipefail
umask 077
export SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"
AMB="${1:-hml}"
cd /opt/gesdoc
COFRE="infra/secrets/$AMB.enc.env"
TMP="$(mktemp -d /dev/shm/cofre.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

# O pipe do PowerShell 5.1 manda BOM e CRLF: remove os dois.
tr -d '\r' | sed '1s/^\xEF\xBB\xBF//' | grep -E '^[A-Z][A-Z0-9_]*=.' > "$TMP/novos.env" || { echo "Nada recebido."; exit 1; }
sops -d "$COFRE" > "$TMP/atual.env"
chaves="$(cut -d= -f1 "$TMP/novos.env" | paste -sd'|')"
{ grep -vE "^($chaves)=" "$TMP/atual.env" || true; cat "$TMP/novos.env"; } > "$TMP/junto.env"
sops -e --input-type dotenv --output-type dotenv --filename-override "$COFRE" "$TMP/junto.env" > "$TMP/novo.enc.env"
# Confere antes de trocar: o novo cofre abre e tem todas as chaves.
sops -d --input-type dotenv --output-type dotenv "$TMP/novo.enc.env" | cut -d= -f1 > "$TMP/nomes"
for c in $(cut -d= -f1 "$TMP/atual.env" "$TMP/novos.env" | grep -v '^#' | sort -u); do
  grep -qx "$c" "$TMP/nomes" || { echo "Faltou $c no cofre novo; nada foi trocado."; exit 1; }
done
cp -p "$COFRE" "$HOME/$AMB.enc.env.bak-$(date +%Y-%m-%d-%H%M%S)"
cat "$TMP/novo.enc.env" > "$COFRE"
echo "Cofre $AMB atualizado. Chaves: $(grep -v '^#' "$TMP/nomes" | paste -sd' ')"
