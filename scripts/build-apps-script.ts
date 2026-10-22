/**
 * Genera los archivos listos para copiar a Google (sin conectarse a Google):
 * - apps-script/Code.gs: reglas compartidas (BtRules) + apps-script/src/Code.js
 * - google-sheets/plantillas/*.csv: plantillas de las pestañas con ejemplos ficticios
 *
 * Uso: npm run sheets:build   (las pruebas verifican que lo generado esté al día)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { TEMPLATES } from '../shared/sheets-templates.js';
import { toCsv } from '../server/csv.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildAppsScript(): Promise<string> {
  const out = await build({
    entryPoints: [path.join(root, 'apps-script/src/rules-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'BtRules',
    target: 'es2019',
    charset: 'utf8',
    legalComments: 'none',
  });
  const rules = out.outputFiles[0].text;
  const code = fs.readFileSync(path.join(root, 'apps-script/src/Code.js'), 'utf8');
  return [
    '// ARCHIVO GENERADO por `npm run sheets:build`. No lo edites aquí: cambia shared/rsvp-rules.ts,',
    '// shared/sheets-schema.ts o apps-script/src/Code.js y vuelve a generarlo.',
    '',
    '// ---- BtRules: reglas compartidas con el servidor ----',
    rules.trim(),
    '',
    code.trim(),
    '',
  ].join('\n');
}

export function buildTemplates(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const t of Object.values(TEMPLATES)) files[`google-sheets/plantillas/${t.file}`] = toCsv(t.header, t.rows);
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(root, 'apps-script/Code.gs'), await buildAppsScript());
  for (const [file, body] of Object.entries(buildTemplates())) fs.writeFileSync(path.join(root, file), body);
  console.log('Generados: apps-script/Code.gs y google-sheets/plantillas/*.csv');
}
