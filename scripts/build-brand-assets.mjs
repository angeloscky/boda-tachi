/**
 * Genera favicon, ícono táctil e imagen para compartir (og-image) a partir de
 * los SVG vectorizados del logo. Uso: node scripts/build-brand-assets.mjs
 * La imagen para compartir solo contiene datos generales de la boda.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pub = path.join(root, 'public');
const mono = fs.readFileSync(path.join(root, 'assets/logo/vector/monograma-claro.svg'), 'utf8');
const logo = fs.readFileSync(path.join(root, 'assets/logo/vector/logo-claro.svg'), 'utf8');

const vb = (svg) => svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
const inner = (svg) => svg.slice(svg.indexOf('<g'), svg.lastIndexOf('</svg>'));

// Favicon cuadrado: monograma claro sobre negro.
const [, , mw, mh] = vb(mono);
const side = Math.max(mw, mh) * 1.25;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect width="${side}" height="${side}" rx="${side * 0.18}" fill="#0B0C0B"/><svg x="${(side - mw) / 2}" y="${(side - mh) / 2}" width="${mw}" height="${mh}" viewBox="0 0 ${mw} ${mh}">${inner(mono)}</svg></svg>`;
fs.writeFileSync(path.join(pub, 'favicon.svg'), favicon);

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();

await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(`<body style="margin:0">${favicon.replace('<svg ', '<svg width="180" height="180" ')}</body>`);
await page.screenshot({ path: path.join(pub, 'apple-touch-icon.png') });

const b64 = Buffer.from(logo).toString('base64');
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<body style="margin:0;width:1200px;height:630px;display:grid;place-items:center;
  background:radial-gradient(700px 420px at 50% 40%,rgba(104,114,84,.35),transparent 70%),#0B0C0B">
  <div style="position:absolute;inset:28px;border:1px solid rgba(184,190,165,.35);border-radius:6px"></div>
  <img src="data:image/svg+xml;base64,${b64}" style="height:520px"></body>`);
await page.screenshot({ path: path.join(pub, 'og-image.jpg'), type: 'jpeg', quality: 88 });
await browser.close();
console.log('Recursos generados en public/');
