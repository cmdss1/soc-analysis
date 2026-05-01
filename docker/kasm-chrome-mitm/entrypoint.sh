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
  echo "[kasm-mitm] Installing MITM CA into system trust store..."
  cp "${MITM_CONF}/mitmproxy-ca-cert.pem" /usr/local/share/ca-certificates/soc-mitm.crt 2>/dev/null || true
  update-ca-certificates 2>/dev/null || true
else
  echo "[kasm-mitm] WARN: mitmproxy CA not found; TLS interception may warn in-browser"
fi

trap - EXIT INT TERM

echo "[kasm-mitm] Delegating to Kasm container startup..."
if [[ -x /dockerstartup/kasm_entrypoint.sh ]]; then
  exec /dockerstartup/kasm_entrypoint.sh "$@"
fi
exec /dockerstartup/kasm_startup.sh "$@"
