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
// PM2 preserves prior env values across reloads; override keeps .env as the
// source of truth after production config changes.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || '3001', 10);
const API_BACKEND_URL = process.env.API_BACKEND_URL || `http://127.0.0.1:${API_PORT}`;
const node22Path = path.join(process.env.HOME || '/home/peanut', '.nvm/versions/node/v22.18.0/bin/node');
const NODE_INTERPRETER = process.env.PM2_NODE_INTERPRETER || (fs.existsSync(node22Path) ? node22Path : process.execPath);

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'taikhoantenhat-api',
      script: 'src/index.js',
      cwd: __dirname,
      interpreter: NODE_INTERPRETER,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        TZ: 'Asia/Ho_Chi_Minh',
        TWOFA_INTERNAL_URL: process.env.TWOFA_INTERNAL_URL || '',
        TWOFA_TMA_SHARED_SECRET: process.env.TWOFA_TMA_SHARED_SECRET || '',
        TWOFA_SYNC_INTERVAL_MS: process.env.TWOFA_SYNC_INTERVAL_MS || '60000',
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
      interpreter: NODE_INTERPRETER,
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
