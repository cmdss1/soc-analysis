#!/usr/bin/env bash
set -euo pipefail

MITM_PORT="${MITM_LISTEN_PORT:-8080}"
MITM_CONF="${MITM_CONFDIR:-/etc/mitmproxy/conf}"

mkdir -p "$MITM_CONF"

wait_port() {
  local port="$1"
  local i
  for i in $(seq 1 80); do
    if bash -c "echo >/dev/tcp/127.0.0.1/${port}" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

wait_ca() {
  local deadline=$(( $(date +%s) + 15 ))
  while [[ $(date +%s) -lt $deadline ]]; do
    if [[ -f "${MITM_CONF}/mitmproxy-ca-cert.pem" ]]; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

echo "[kasm-mitm] Starting mitmdump on ${MITM_PORT} (confdir=${MITM_CONF})..."
mitmdump \
  --listen-port "$MITM_PORT" \
  --set "confdir=${MITM_CONF}" \
  --scripts /opt/soc/mitm_addon.py \
  &
MITM_PID=$!
disown "$MITM_PID" 2>/dev/null || true

cleanup() {
  kill "$MITM_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_port "$MITM_PORT" || echo "[kasm-mitm] WARN: mitm port not accepting connections yet"

if wait_ca; then
  if [[ $(id -u) -eq 0 ]]; then
    echo "[kasm-mitm] Installing MITM CA into system trust store..."
    cp "${MITM_CONF}/mitmproxy-ca-cert.pem" /usr/local/share/ca-certificates/soc-mitm.crt 2>/dev/null || true
    update-ca-certificates 2>/dev/null || true
  else
    echo "[kasm-mitm] MITM CA at ${MITM_CONF}/mitmproxy-ca-cert.pem (system CA install skipped for UID $(id -u); Chrome policy still uses proxy)."
  fi
else
  echo "[kasm-mitm] WARN: mitmproxy CA not found; TLS interception may warn in-browser"
fi

trap - EXIT INT TERM

echo "[kasm-mitm] Delegating to Kasm container startup chain..."
# Upstream kasmweb/core ENTRYPOINT chain: default_profile -> vnc_startup -> kasm_startup, CMD=--wait.
# We replaced the ENTRYPOINT, so we must reproduce the full chain (and default --wait) ourselves.
if [[ $# -eq 0 ]]; then
  set -- --wait
fi
exec /dockerstartup/kasm_default_profile.sh /dockerstartup/vnc_startup.sh /dockerstartup/kasm_startup.sh "$@"
