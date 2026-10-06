#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE22_BIN="${NODE22_BIN:-$HOME/.nvm/versions/node/v22.18.0/bin}"
if [[ -x "$NODE22_BIN/node" ]]; then
  export PATH="$NODE22_BIN:$PATH"
fi
hash -r

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if (( NODE_MAJOR < 22 )); then
  echo "Node >=22 is required. Current: $(node -v)" >&2
  echo "Set NODE22_BIN=/path/to/node22/bin or install Node 22 with nvm." >&2
  exit 1
fi

read_env() {
  local key="$1"
  node - "$key" <<'NODE'
const fs = require('node:fs')
const key = process.argv[2]
const envPath = '.env'
if (!fs.existsSync(envPath)) process.exit(0)

for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim()
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq === -1) continue
  const name = line.slice(0, eq).trim()
  if (name !== key) continue
  let value = line.slice(eq + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  process.stdout.write(value)
  break
}
NODE
}

API_PORT="${API_PORT:-$(read_env API_PORT)}"
WEB_PORT="${WEB_PORT:-$(read_env WEB_PORT)}"
WEB_URL="${WEB_URL:-$(read_env WEB_URL)}"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-3001}"

export NODE_ENV=production
export WEB_PORT
export API_BACKEND_URL="${API_BACKEND_URL:-$(read_env API_BACKEND_URL)}"
export API_BACKEND_URL="${API_BACKEND_URL:-http://127.0.0.1:${API_PORT}}"
NEXT_PUBLIC_API_URL_FROM_ENV="$(read_env NEXT_PUBLIC_API_URL)"
if [[ -n "$NEXT_PUBLIC_API_URL_FROM_ENV" ]]; then
  export NEXT_PUBLIC_API_URL="$NEXT_PUBLIC_API_URL_FROM_ENV"
else
  unset NEXT_PUBLIC_API_URL
fi

echo "==> Using node $(node -v) ($(command -v node))"
echo "==> API_BACKEND_URL=$API_BACKEND_URL"
echo "==> NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-/api/v1}"
echo "==> WEB_PORT=$WEB_PORT"

echo "==> Installing dependencies"
npm ci --include=dev
npm ci --include=dev --prefix web

echo "==> Building Next.js web"
npm run build:web

echo "==> Caching product images"
npm run cache:product-images

echo "==> Reloading PM2 apps"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "==> PM2 status"
pm2 list | sed -n '/taikhoantenhat/p'

if [[ -n "$WEB_URL" ]]; then
  HEALTH_URL="${WEB_URL%/}/api/v1/health"
else
  HEALTH_URL="http://127.0.0.1:${WEB_PORT}/api/v1/health"
fi

echo "==> Health check: $HEALTH_URL"
for attempt in {1..10}; do
  if curl -fsS --max-time 15 "$HEALTH_URL"; then
    echo
    break
  fi
  if [[ "$attempt" == "10" ]]; then
    echo "Health check failed after ${attempt} attempts." >&2
    exit 1
  fi
  echo
  echo "Health check failed; retrying in 2s (${attempt}/10)..."
  sleep 2
done
echo "==> Deploy complete"
