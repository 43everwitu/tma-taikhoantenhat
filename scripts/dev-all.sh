#!/usr/bin/env bash
# Rebuild clean dev assets, stop stale listeners, then run all services.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-3001}"
MBBANK_PORT="${MBBANK_PORT:-8000}"
NODE_VERSION="$(tr -d '[:space:]' < .nvmrc 2>/dev/null || echo 22)"

mkdir -p logs

# Keep terminal and log output readable in Cursor.
export NO_COLOR=1
export FORCE_COLOR=0
export NEXT_TELEMETRY_DISABLED=1

log() {
  printf '%s\n' "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

resolve_node() {
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
    nvm use "$NODE_VERSION" >/dev/null 2>&1 || nvm install "$NODE_VERSION" >/dev/null
  fi

  command -v node >/dev/null 2>&1 || die "node not found"
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$NODE_MAJOR" -ge 22 ] 2>/dev/null || die "Node 22+ required; current is $(node --version)"

  NODE_BIN="$(command -v node)"
  export PATH="$(dirname "$NODE_BIN"):$PATH"
  log "Using node: $NODE_BIN ($(node --version))"
}

resolve_python() {
  PYTHON_BIN="$(command -v python3 || command -v python || true)"
  [ -n "$PYTHON_BIN" ] || die "python3 not found"
  export PYTHON_BIN
  log "Using python: $PYTHON_BIN ($("$PYTHON_BIN" --version 2>&1))"
}

stop_port() {
  local port="$1"
  local label="$2"
  local pids

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    log "$label :$port is free"
    return
  fi

  log "Stopping $label on :$port (pid: $(echo "$pids" | tr '\n' ' '))"
  kill $pids 2>/dev/null || true
  sleep 1

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "Force stopping $label on :$port (pid: $(echo "$pids" | tr '\n' ' '))"
    kill -9 $pids 2>/dev/null || true
  fi
}

sync_python_deps() {
  local want have

  want="$(awk -F'==' '/^mbbank-lib==/{print $2; exit}' mbbank-api/requirements.txt)"
  have="$("$PYTHON_BIN" -c 'import importlib.metadata as m; print(m.version("mbbank-lib"))' 2>/dev/null || echo none)"
  if [ -n "$want" ] && [ "$want" != "$have" ]; then
    log "Installing mbbank-api requirements (mbbank-lib $have -> $want)"
    "$PYTHON_BIN" -m pip install --quiet --upgrade -r mbbank-api/requirements.txt
  fi
}

clean_dev_builds() {
  log "Cleaning dev build cache"
  rm -rf web/.next
  : > logs/mbbank.log
  : > logs/api.log
  : > logs/web.log
}

main() {
  resolve_node
  resolve_python
  sync_python_deps

  stop_port "$MBBANK_PORT" "mbbank-api"
  stop_port "$API_PORT" "api"
  stop_port "$WEB_PORT" "web"
  clean_dev_builds

  log "Starting dev services"
  npx concurrently \
    -n mbbank,api,web \
    -c yellow,green,cyan \
    --restart-tries=-1 \
    --restart-after=2000 \
    "bash -c 'cd mbbank-api && \"\$PYTHON_BIN\" -m uvicorn app.main:app --host 0.0.0.0 --port \"$MBBANK_PORT\" --reload --no-use-colors 2>&1 | tee -a ../logs/mbbank.log'" \
    "bash -c 'node --watch src/index.js 2>&1 | tee -a logs/api.log'" \
    "bash -c 'cd web && npm run dev -- --port \"$WEB_PORT\" 2>&1 | tee -a ../logs/web.log'"
}

main "$@"
