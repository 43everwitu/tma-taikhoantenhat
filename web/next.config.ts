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

// Dev tunnel hosts. DEV_TUNNEL_HOST env can pin a specific quick-tunnel
// hostname; the wildcards cover Cloudflare Tunnel and ngrok defaults.
const tunnelHost = process.env.DEV_TUNNEL_HOST

const nextConfig: NextConfig = {
  turbopack: { root: dir },
  outputFileTracingRoot: dir,
  allowedDevOrigins: [
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok.app',
    '*.ngrok.io',
    '*.taikhoantenhat.me',
    ...(tunnelHost ? [tunnelHost] : []),
  ],
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_BACKEND}/api/:path*` },
      { source: '/uploads/:path*', destination: `${API_BACKEND}/uploads/:path*` },
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**.trycloudflare.com' },
      { protocol: 'https', hostname: '**.ngrok-free.app' },
      { protocol: 'https', hostname: '**.taikhoantenhat.me' },
    ],
  },
}

export default nextConfig
