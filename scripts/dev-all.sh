#!/usr/bin/env bash
# Run all services concurrently, tee each stream to logs/<service>.log AND console.
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
mkdir -p logs

# Suppress ANSI colors in logs at source. Each child process inherits these env
# vars; logs end up clean without needing post-processing through sed/perl.
export NO_COLOR=1
export FORCE_COLOR=0
export NEXT_TELEMETRY_DISABLED=1

PYTHON_BIN="$(command -v python3 || command -v python)"
[ -z "$PYTHON_BIN" ] && { echo "❌ python3 not found"; exit 1; }

# Sync mbbank-api Python deps. Pinned versions in requirements.txt only take
# effect via explicit install; pip won't auto-upgrade an already-present pkg.
# Cheap idempotent check: compare installed mbbank-lib to the requirement.
WANT_MBBANK="$(awk -F'==' '/^mbbank-lib==/{print $2; exit}' mbbank-api/requirements.txt)"
HAVE_MBBANK="$("$PYTHON_BIN" -c 'import importlib.metadata as m; print(m.version("mbbank-lib"))' 2>/dev/null || echo none)"
if [ -n "$WANT_MBBANK" ] && [ "$WANT_MBBANK" != "$HAVE_MBBANK" ]; then
  echo "🔄 mbbank-lib $HAVE_MBBANK → $WANT_MBBANK; installing requirements..."
  "$PYTHON_BIN" -m pip install --quiet --upgrade -r mbbank-api/requirements.txt
fi

# Ensure Node 20+ even when invoked from a shell using older Node.
# Resolve a node 20+ binary up front so concurrently child processes inherit it.
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  CUR_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "$CUR_MAJOR" -ge 20 ] 2>/dev/null && NODE_BIN="$(command -v node)"
fi
if [ -z "$NODE_BIN" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
  \. "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  nvm use 20 >/dev/null 2>&1 || nvm use --lts >/dev/null 2>&1 || true
  NODE_BIN="$(command -v node)"
fi
[ -z "$NODE_BIN" ] && { echo "❌ node 20+ not found (install Node 20 or run via nvm)"; exit 1; }

# Prepend node's directory to PATH so child processes (npm, npx, next dev) use it.
NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:$PATH"
echo "Using node: $NODE_BIN ($($NODE_BIN --version))"

export PYTHON_BIN

# --restart-tries=-1 + --restart-after lets each service self-recover when
# the others crash or a file save triggers a fatal error mid-init. Dropped
# --kill-others-on-fail intentionally: a syntax error in one process should
# not nuke the other two — `next dev` has Turbopack overlay for web errors
# and `node --watch` will pick up the next save for the api.
npx concurrently \
  -n mbbank,api,web \
  -c yellow,green,cyan \
  --restart-tries=-1 \
  --restart-after=2000 \
  "bash -c 'cd mbbank-api && [ -f .env ] && { set -a; . ./.env; set +a; }; \"\$PYTHON_BIN\" -m uvicorn app.main:app --port 8000 --reload --no-use-colors 2>&1 | tee -a ../logs/mbbank.log'" \
  "bash -c 'node --watch src/index.js 2>&1 | tee -a logs/api.log'" \
  "bash -c 'cd web && npm run dev 2>&1 | tee -a ../logs/web.log'"
