#!/usr/bin/env bash
# Runs **after** /dockerstartup/kasm_default_profile.sh so Chrome's NSS DB is not
# overwritten by the copied default profile (otherwise mitm CA install is lost).
set -euo pipefail

MITM_CONF="${MITM_CONFDIR:-/home/kasm-user/.mitmproxy}"
CA_PEM="${MITM_CONF}/mitmproxy-ca-cert.pem"

wait_ca() {
  local deadline=$(( $(date +%s) + 20 ))
  while [[ $(date +%s) -lt $deadline ]]; do
    [[ -f "$CA_PEM" ]] && return 0
    sleep 0.1
  done
  return 1
}

if ! wait_ca; then
  echo "[kasm-mitm-nss] WARN: CA not found at $CA_PEM (mitmdump may still be starting)"
  exec "$@"
fi

if command -v certutil >/dev/null 2>&1; then
  NSSDB="${HOME:-/home/kasm-user}/.pki/nssdb"
  mkdir -p "$NSSDB"
  if [[ ! -f "$NSSDB/cert9.db" ]]; then
    certutil -d "sql:$NSSDB" -N --empty-password >/dev/null 2>&1 || true
  fi
  certutil -d "sql:$NSSDB" -D -n "soc-mitm" >/dev/null 2>&1 || true
  if certutil -d "sql:$NSSDB" -A -t "C,," -n "soc-mitm" -i "$CA_PEM"; then
    echo "[kasm-mitm-nss] Installed mitmproxy CA into NSS DB $NSSDB (after Kasm profile merge)"
  else
    echo "[kasm-mitm-nss] WARN: certutil -A failed for $NSSDB"
  fi
else
  echo "[kasm-mitm-nss] WARN: certutil missing"
fi

exec "$@"
