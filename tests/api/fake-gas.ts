/**
 * DOBLE DE PRUEBA de Google Apps Script: SpreadsheetApp, LockService, CacheService,
 * PropertiesService, Utilities y ContentService en memoria. Ejecuta el apps-script/Code.gs
 * real dentro de un contexto vm. Sirve para probar la lógica; NO acredita una conexión real.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import type { FetchLike, FetchResponseLike } from '../../server/sheets/client.js';

const signed = (buf: Buffer) => [...buf].map((b) => (b > 127 ? b - 256 : b));

export class FakeSheet {
  failWrites = false;
  dropWrites = false;
  constructor(
    public name: string,
    public values: unknown[][],
  ) {}
  width() {
    return Math.max(0, ...this.values.map((r) => r.length));
  }
  getName() {
    return this.name;
  }
  getDataRange() {
    const w = this.width();
    return { getValues: () => this.values.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? '')) };
  }
  getLastRow() {
    return this.values.length;
  }
  getMaxRows() {
    return Math.max(this.values.length, 10);
  }
  getRange(row: number, col: number, nrows = 1, ncols = 1) {
    return new FakeRange(this, row, col, nrows, ncols);
  }
  appendRow(arr: unknown[]) {
    if (this.failWrites) throw new Error('Servicio no disponible (simulado)');
    if (!this.dropWrites) this.values.push([...arr]);
  }
  setFrozenRows() {}
  clearContents() {
    this.values = [];
    return this;
  }
  protect() {
    return protection;
  }
}

const protection = { setDescription: () => protection, setWarningOnly: () => protection };

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private nrows: number,
    private ncols: number,
  ) {}
  getRow() {
    return this.row;
  }
  getValues() {
    return Array.from({ length: this.nrows }, (_, r) => Array.from({ length: this.ncols }, (_, c) => this.sheet.values[this.row - 1 + r]?.[this.col - 1 + c] ?? ''));
  }
  setValues(v: unknown[][]) {
    if (this.sheet.failWrites) throw new Error('Servicio no disponible (simulado)');
    if (this.sheet.dropWrites) return this;
    v.forEach((rowVals, r) => {
      const idx = this.row - 1 + r;
      while (this.sheet.values.length <= idx) this.sheet.values.push([]);
      rowVals.forEach((val, c) => (this.sheet.values[idx][this.col - 1 + c] = val));
    });
    return this;
  }
  setValue(v: unknown) {
    return this.setValues([[v]]);
  }
  setNumberFormat() {
    return this;
  }
  setDataValidation() {
    return this;
  }
  setNote() {
    return this;
  }
  setFormula() {
    return this;
  }
  insertCheckboxes() {
    return this;
  }
  protect() {
    return protection;
  }
}

export const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbPRUEBAprueba0123456789abcdef/exec';
export const SECRET = 'secreto-compartido-de-prueba-0123456789';

export function createGas(tabs: Record<string, unknown[][]>, opts: { secret?: string | null; codePath?: string } = {}) {
  const sheets = new Map(Object.entries(tabs).map(([name, values]) => [name, new FakeSheet(name, values)]));
  const cache = new Map<string, string>();
  const lock = { busy: false };
  const props: Record<string, string | null> = { BT_SHARED_SECRET: opts.secret === undefined ? SECRET : opts.secret };
  const ss = { getSheetByName: (n: string) => sheets.get(n) ?? null, insertSheet: (n: string) => sheets.set(n, new FakeSheet(n, [])).get(n) };
  const ctx: Record<string, unknown> = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {}, getUi: () => ({ alert: () => {} }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !lock.busy, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k: string) => props[k] ?? null }) },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => void cache.set(k, v) }) },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (value: string, key: string) => signed(crypto.createHmac('sha256', key).update(value, 'utf8').digest()),
      computeDigest: (_alg: string, value: string) => signed(crypto.createHash('sha256').update(value, 'utf8').digest()),
      base64EncodeWebSafe: (bytes: number[]) => Buffer.from(bytes.map((b) => b & 0xff)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      getUuid: () => crypto.randomUUID(),
      // Solo el formato que usa el script: ISO con desfase de CDMX (UTC−6).
      formatDate: (d: Date) => new Date(d.getTime() - 6 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '-06:00'),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => {
        const out = { text, setMimeType: () => out, getContent: () => text };
        return out;
      },
    },
    console: { error: () => {}, log: () => {} },
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(opts.codePath ?? path.resolve(__dirname, '../../apps-script/Code.gs'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'Code.gs' });
  const doPost = (body: string) => JSON.parse((ctx.doPost as (e: unknown) => { getContent(): string })({ postData: { contents: body } }).getContent());
  /** Funciones internas del script (menú y escritura) para probarlas directamente. */
  const fn = <T = unknown>(name: string, ...args: unknown[]) => (ctx[name] as (...a: unknown[]) => T)(...args);
  return { ctx, ss, sheets, cache, lock, props, doPost, fn };
}

const resp = (status: number, body: string, headers: Record<string, string> = {}): FetchResponseLike => ({
  status,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  text: async () => body,
});

/**
 * Simula la web app: POST /exec ejecuta doPost y responde 302 hacia googleusercontent,
 * donde un GET entrega el resultado (así funciona Apps Script).
 */
export function fakeWebApp(gas: ReturnType<typeof createGas>, opts: { tamper?: (body: string) => string; mode?: 'ok' | 'login' | 'html' } = {}) {
  const echoes = new Map<string, string>();
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    if (url === WEBAPP_URL && init.method === 'POST') {
      if (opts.mode === 'login') return resp(302, '', { location: 'https://accounts.google.com/ServiceLogin?continue=x' });
      if (opts.mode === 'html') return resp(200, '<html><body>Error</body></html>', { 'content-type': 'text/html' });
      const out = JSON.stringify(gas.doPost(init.body ?? ''));
      const key = crypto.randomUUID();
      echoes.set(key, opts.tamper ? opts.tamper(out) : out);
      return resp(302, '', { location: `https://script.googleusercontent.com/macros/echo?user_content_key=${key}&lib=x` });
    }
    if (url.startsWith('https://script.googleusercontent.com/macros/echo') && init.method === 'GET') {
      const body = echoes.get(new URL(url).searchParams.get('user_content_key') ?? '');
      return body ? resp(200, body, { 'content-type': 'application/json' }) : resp(404, 'no');
    }
    return resp(404, 'no');
  };
  return { fetchImpl, calls };
}

export const TOKEN_A = 'tokenFamiliaA_0123456789';
export const TOKEN_B = 'tokenFamiliaB_9876543210';

/** Hoja ficticia: dos familias, columnas en el orden de la plantilla. */
export function sampleTabs() {
  return {
    Invitaciones: [
      ['id_invitacion', 'lado', 'grupo', 'contacto_principal', 'telefono', 'cupo', 'activa', 'token', 'enlace', 'notas'],
      ['INV-001', 'novia', 'Familia Ejemplo A', 'Contacto A', '523300000001', 4, 'sí', TOKEN_A, '', 'nota privada A'],
      ['INV-002', 'novio', 'Familia Ejemplo B', 'Contacto B', '523300000002', 2, 'sí', TOKEN_B, '', 'nota privada B'],
    ],
    Personas: [
      ['id_persona', 'id_invitacion', 'nombre', 'activa'],
      ['INV-001-P1', 'INV-001', 'Ana Ejemplo', 'sí'],
      ['INV-001-P2', 'INV-001', 'Luis Ejemplo', 'sí'],
      ['INV-001-P3', 'INV-001', 'Sara Ejemplo', 'sí'],
      ['INV-001-P4', 'INV-001', 'Tomás Ejemplo', 'sí'],
      ['INV-002-P1', 'INV-002', 'Carla Ejemplo', 'sí'],
      ['INV-002-P2', 'INV-002', 'Dani Ejemplo', 'no'],
    ],
    Respuestas: [['id_invitacion', 'personas_seleccionadas', 'estado', 'revision', 'fecha_hora', 'id_solicitud']],
    Config: [
      ['confirmaciones_abiertas', true],
      ['url_publica', 'https://boda.example'],
      ['version_estructura', '1'],
    ],
  };
}
