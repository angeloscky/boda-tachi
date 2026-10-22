import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
// En este entorno Chromium ya está instalado; en otro equipo: npx playwright install chromium
const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = fs.existsSync(localChromium) ? { executablePath: localChromium } : {};

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, launchOptions, trace: 'retain-on-failure' },
  projects: [
    { name: 'movil', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions } },
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions } },
  ],
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning tests/e2e/server.mjs',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(PORT), PUBLIC_BASE_URL: `http://localhost:${PORT}`, ADMIN_PASSWORD: 'e2e-contraseña-123', DB_PATH: './data/e2e.sqlite' },
  },
});
