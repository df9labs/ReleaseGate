import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';

const transientRoot = resolve('.work');
mkdirSync(transientRoot, { recursive: true });
process.env.RG_E2E_DATA ??= mkdtempSync(join(transientRoot, 'journey-'));
process.env.RG_E2E_PASSWORD ??= randomBytes(24).toString('hex');
const port = Number(process.env.RG_E2E_PORT ?? 4361);
const baseURL = 'http://127.0.0.1:' + port;
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 65_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: {
    baseURL,
    actionTimeout: 8_000,
    viewport: { width: 1440, height: 900 },
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined),
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node --import tsx server/index.ts',
    port,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: process.env.RG_E2E_DATA,
      DEMO_ADMIN_EMAIL: 'admin@releasegate.local',
      DEMO_ADMIN_PASSWORD: process.env.RG_E2E_PASSWORD,
      LLM_API_KEY: '',
      DF9_INTAKE_KEY: '',
      DF9_INTAKE_KEYS: '',
    },
  },
});
