import type { NextConfig } from 'next'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Pin to this app's directory so Next 16 stops inferring the parent monorepo
// root from the bot's package-lock.json. ESM has no __dirname, so derive it
// from import.meta.url.
const dir = path.dirname(fileURLToPath(import.meta.url))

// Backend (Express + bot) runs on a separate port. Proxy /api/* through
// Next so the browser always uses same-origin URLs — critical for mobile
// devices on the LAN that hit `http://192.168.x.x:3001` and would otherwise
// resolve `localhost:3000` to their own loopback (no server there).
const API_BACKEND = process.env.API_BACKEND_URL || 'http://localhost:3000'

const nextConfig: NextConfig = {
  turbopack: { root: dir },
  outputFileTracingRoot: dir,
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_BACKEND}/api/:path*` },
    ]
  },
}

export default nextConfig
