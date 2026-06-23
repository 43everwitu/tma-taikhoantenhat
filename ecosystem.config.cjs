/**
 * PM2 ecosystem — Taikhoantenhat production
 *
 * Chạy 2 process: Node API+bot + Next.js web.
 * MBBank sidecar KHÔNG nằm ở đây — trỏ MBBANK_API_URL trong .env tới process có sẵn.
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload ecosystem.config.cjs
 *   pm2 logs
 */

const path = require('node:path');
const fs = require('node:fs');

// Load .env from repo root so PM2 picks up API_PORT / WEB_PORT / secrets.
require('dotenv').config({ path: path.join(__dirname, '.env') });

const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || '3001', 10);
const API_BACKEND_URL = process.env.API_BACKEND_URL || `http://127.0.0.1:${API_PORT}`;

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'taikhoantenhat-api',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Ho_Chi_Minh',
      },
      error_file: path.join(logsDir, 'pm2-api-error.log'),
      out_file: path.join(logsDir, 'pm2-api-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'taikhoantenhat-web',
      script: 'node_modules/next/dist/bin/next',
      args: `start -p ${WEB_PORT}`,
      cwd: path.join(__dirname, 'web'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '768M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Ho_Chi_Minh',
        PORT: String(WEB_PORT),
        API_BACKEND_URL,
      },
      error_file: path.join(logsDir, 'pm2-web-error.log'),
      out_file: path.join(logsDir, 'pm2-web-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
