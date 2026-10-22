/* ============================================================================
 * Boda Sofía e Isaac · conector de Google Sheets (Apps Script)
 *
 * Estado: PREPARADO, NO CONECTADO. Se probó solo con dobles locales; no se ha
 * ejecutado en Google. Ver google-sheets/README.md para instalarlo.
 *
 * Qué hace:
 * - Web app (doPost) que solo acepta las operaciones ping, getInvitation,
 *   saveResponse y summary, firmadas con HMAC-SHA256 por el servidor de la
 *   invitación. No expone lectura ni escritura de rangos arbitrarios.
 * - Cada respuesta va firmada y repite la operación y el nonce, para que el
 *   servidor pueda verificar que la escribió este script.
 * - saveResponse lee, valida (mismas reglas que el servidor, en BtRules) y
 *   escribe bajo LockService; si el bloqueo está ocupado o la escritura falla,
 *   devuelve un error reintentable, nunca un éxito.
 * - Menú "Boda" en la hoja: preparar estructura, generar/regenerar/revocar
 *   enlaces, revisar la lista y abrir/cerrar confirmaciones.
 *
 * Límite honesto: el bloqueo del script coordina las escrituras del script;
 * NO impide que alguien edite la hoja a mano al mismo tiempo. Para cambios
 * sensibles con confirmaciones abiertas, usa el menú o cierra las
 * confirmaciones mientras editas.
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   BT_SHARED_SECRET   el mismo valor que SHEETS_SHARED_SECRET en el servidor (≥ 32 caracteres)
 *
 * El script va vinculado a la hoja (Extensiones → Apps Script) y solo pide acceso
 * a esa hoja (alcance spreadsheets.currentonly).
 * ========================================================================== */

var BT_TZ = 'America/Mexico_City';
var BT_LOCK_MS = 10000;
var BT_MAX_PAYLOAD = 20000;

// ---------------------------------------------------------------- web app

function doPost(e) {
  var req = null;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || 'null');
  } catch (err) {
    return json_({ ok: false, code: 'bad_request' });
  }
  var auth = verifyRequest_(req);
  if (!auth.ok) return json_({ ok: false, code: auth.code });
  var data;
  try {
    data = dispatch_(req.op, JSON.parse(req.payload));
  } catch (err) {
    console.error(err);
    data = { ok: false, status: 500, code: 'script_error', message: 'Error interno del script.', retryable: true };
  }
  return signedReply_(auth.secret, req.op, req.nonce, data);
}

function doGet() {
  return json_({ ok: false, code: 'method_not_allowed' });
}

function dispatch_(op, payload) {
  if (op === 'ping') return { ok: true, result: { schemaVersion: BtRules.SHEETS_SCHEMA_VERSION, rulesVersion: BtRules.RULES_VERSION, tabs: checkStructure_(ss_()) } };
  if (op === 'getInvitation') return getInvitation_(payload && payload.token);
  if (op === 'saveResponse') return saveResponse_(payload && payload.token, payload && payload.request);
  if (op === 'summary') return summary_();
  return { ok: false, status: 400, code: 'unknown_op', message: 'Operación no permitida.' };
}

function secret_() {
  var s = PropertiesService.getScriptProperties().getProperty('BT_SHARED_SECRET');
  return s && s.length >= 32 ? s : null;
}

function verifyRequest_(req) {
  if (!req || typeof req !== 'object') return { ok: false, code: 'bad_request' };
  if (req.v !== BtRules.CONNECTOR_VERSION || BtRules.CONNECTOR_OPS.indexOf(req.op) < 0) return { ok: false, code: 'bad_request' };
  if (typeof req.ts !== 'number' || typeof req.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(req.nonce)) return { ok: false, code: 'bad_request' };
  if (typeof req.payload !== 'string' || req.payload.length > BT_MAX_PAYLOAD || typeof req.sig !== 'string') return { ok: false, code: 'bad_request' };
  var secret = secret_();
  if (!secret) return { ok: false, code: 'not_configured' };
  // Primero la firma (así nadie sin el secreto llena la caché de nonces), luego el reloj y la repetición.
  var expected = hmacHex_(secret, BtRules.signingString(['req', req.v, req.op, req.ts, req.nonce, req.payload]));
  if (!sameText_(expected, req.sig)) return { ok: false, code: 'unauthorized' };
  if (Math.abs(Date.now() - req.ts) > BtRules.CONNECTOR_MAX_SKEW_MS) return { ok: false, code: 'unauthorized' };
  var cache = CacheService.getScriptCache();
  if (cache.get('n_' + req.nonce)) return { ok: false, code: 'unauthorized' };
  cache.put('n_' + req.nonce, '1', 900);
  return { ok: true, secret: secret };
}

function signedReply_(secret, op, nonce, data) {
  var dataJson = JSON.stringify(data);
  var sig = hmacHex_(secret, BtRules.signingString(['res', BtRules.CONNECTOR_VERSION, op, nonce, dataJson]));
  return json_({ v: BtRules.CONNECTOR_VERSION, op: op, nonce: nonce, data: dataJson, sig: sig });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hmacHex_(secret, text) {
  var bytes = Utilities.computeHmacSha256Signature(text, secret, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function sameText_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- lectura de la hoja (por encabezado, nunca por posición)

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function norm_(h) {
  return String(h == null ? '' : h).trim().toLowerCase();
}

function structureError_(message) {
  var e = new Error(message);
  e.btStructure = true;
  return e;
}

function readTab_(ss, tab) {
  var sheet = ss.getSheetByName(tab.name);
  if (!sheet) throw structureError_('Falta la pestaña ' + tab.name + '.');
  var values = sheet.getDataRange().getValues();
  var header = values.length ? values[0] : [];
  var index = {};
  for (var i = 0; i < header.length; i++) {
    for (var c = 0; c < tab.columns.length; c++) {
      if (norm_(header[i]) === tab.columns[c].header) index[tab.columns[c].key] = i;
    }
  }
  tab.columns.forEach(function (col) {
    if (col.required && index[col.key] === undefined) throw structureError_('Falta la columna ' + col.header + ' en ' + tab.name + '.');
  });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var data = {};
    var empty = true;
    for (var k in index) {
      data[k] = values[r][index[k]];
      if (data[k] !== '' && data[k] !== null && data[k] !== undefined) empty = false;
    }
    if (!empty) rows.push({ row: r + 1, data: data });
  }
  return { sheet: sheet, index: index, width: header.length, rows: rows };
}

function invitations_(ss) {
  return readTab_(ss, BtRules.INVITATIONS_TAB).rows.map(function (r) {
    var parsed = BtRules.parseInvitationRow(r.data);
    parsed.row = r.row;
    return parsed;
  });
}

function peopleRows_(ss) {
  return readTab_(ss, BtRules.PEOPLE_TAB).rows.map(function (r) {
    return BtRules.parsePersonRow(r.data);
  });
}

function responseRows_(table) {
  return table.rows.map(function (r) {
    var parsed = BtRules.parseResponseRow(r.data);
    parsed.row = r.row;
    return parsed;
  });
}

var valueOf_ = function (p) { return p.value; };

/**
 * Carga todo lo que una operación del invitado necesita, o el error que corresponde.
 * La hoja se edita a mano: antes de servir o escribir se comprueba que esta invitación
 * no comparte ID, personas ni respuesta con otra y que sus filas son válidas.
 */
function loadContext_(ss, token) {
  var invRows = invitations_(ss);
  var matches = invRows.filter(function (p) { return p.value.token === token && p.value.id; });
  // Un token repetido es un error de la lista: no se adivina a qué familia pertenece.
  if (matches.length !== 1) return { error: NOT_FOUND };
  var target = matches[0];
  var inv = target.value;
  // Una fila de demostración o de ejemplo nunca se atiende como invitación real.
  if (BtRules.DEMO_ID_RE.test(inv.id)) return { error: NOT_FOUND };
  var peopleRows = peopleRows_(ss);
  var table = readTab_(ss, BtRules.RESPONSES_TAB);
  var responseRows = responseRows_(table);
  var blockers = BtRules.invitationBlockers(target, { invitations: invRows, people: peopleRows, responses: responseRows });
  if (blockers.length) {
    console.error('Invitación ' + inv.id + ' sin atender hasta revisar la hoja: ' + blockers.join(' | '));
    return { error: NEEDS_REVIEW };
  }
  if (!inv.active) return { error: NOT_FOUND };
  var k = inv.id.toLowerCase();
  var people = BtRules.sortPeopleById(peopleRows.map(valueOf_).filter(function (p) { return p.invitationId.toLowerCase() === k; }));
  var own = responseRows.filter(function (r) { return r.value.invitationId.toLowerCase() === k; });
  return { inv: inv, people: people, table: table, row: own.length ? own[0].row : null, current: own.length ? own[0].value : null };
}

function responsesOf_(table, invitationId) {
  var k = String(invitationId).toLowerCase();
  return table.rows.filter(function (r) { return String(r.data.invitationId).trim().toLowerCase() === k; });
}

function configRow_(ss, key) {
  var sheet = ss.getSheetByName(BtRules.CONFIG_TAB.name);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  for (var r = 0; r < values.length; r++) if (norm_(values[r][0]) === key) return { sheet: sheet, row: r + 1, value: values[r][1] };
  return null;
}

/** Sin pestaña Config o sin el ajuste, las confirmaciones se consideran cerradas. */
function rsvpOpen_(ss) {
  var c = configRow_(ss, BtRules.CONFIG_TAB.keys.rsvpOpen.key);
  return c ? BtRules.parseBool(c.value, false) === true : false;
}

function nowIso_() {
  return Utilities.formatDate(new Date(), BT_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

var NOT_FOUND = { ok: false, status: 404, code: 'not_found', message: BtRules.NOT_FOUND_MESSAGE };
// Datos de la hoja que hay que corregir a mano: no es reintentable ni se adivina.
var NEEDS_REVIEW = { ok: false, status: 409, code: 'needs_review', message: BtRules.REVIEW_MESSAGE };

function activePeople_(people) {
  return people.filter(function (p) { return p.active; });
}

function guestPayload_(inv, people, response, open) {
  // Solo lo necesario para esta invitación: sin teléfono, notas, lado ni contacto.
  return { invitation: { group: inv.group, seats: inv.seats }, people: activePeople_(people), response: response, rsvpOpen: open };
}

// ---------------------------------------------------------------- operaciones

function getInvitation_(token) {
  if (typeof token !== 'string' || !BtRules.LIVE_TOKEN_RE.test(token)) return NOT_FOUND;
  try {
    var ss = ss_();
    var ctx = loadContext_(ss, token);
    if (ctx.error) return ctx.error;
    return { ok: true, result: guestPayload_(ctx.inv, ctx.people, ctx.current, rsvpOpen_(ss)) };
  } catch (err) {
    console.error(err);
    return { ok: false, status: 500, code: err && err.btStructure ? 'structure' : 'read_failed', message: String((err && err.message) || err), retryable: true };
  }
}

function saveResponse_(token, request) {
  var parsed = BtRules.parseRsvpRequest(request);
  if (!parsed.ok) return parsed;
  if (typeof token !== 'string' || !BtRules.LIVE_TOKEN_RE.test(token)) return NOT_FOUND;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BT_LOCK_MS)) {
    return { ok: false, status: 503, code: 'busy', message: 'El registro está ocupado; inténtalo de nuevo.', retryable: true };
  }
  try {
    var ss = ss_();
    var ctx = loadContext_(ss, token);
    if (ctx.error) return ctx.error;
    var inv = ctx.inv;
    var people = ctx.people;
    var current = ctx.current;
    var open = rsvpOpen_(ss);
    var decision = BtRules.decideRsvp(
      { invitation: { id: inv.id, seats: inv.seats, active: inv.active }, people: people, current: current, rsvpOpen: open, now: nowIso_() },
      parsed.value,
    );
    if (!decision.ok) {
      if (decision.code === 'conflict') {
        return { ok: false, status: 409, code: 'conflict', message: decision.message, current: guestPayload_(inv, people, current, open) };
      }
      return { ok: false, status: decision.status, code: decision.code, message: decision.message };
    }
    if (decision.action === 'write') {
      writeResponse_(ctx.table, ctx.row, decision.response);
      SpreadsheetApp.flush();
      // Acuse verificable: se vuelve a leer la fila y debe coincidir con lo escrito.
      var check = responsesOf_(readTab_(ss, BtRules.RESPONSES_TAB), inv.id);
      if (
        check.length !== 1 ||
        String(check[0].data.requestId) !== decision.response.requestId ||
        Number(check[0].data.revision) !== decision.response.revision
      ) {
        return { ok: false, status: 500, code: 'write_failed', message: 'No se pudo comprobar la escritura.', retryable: true };
      }
    }
    var result = guestPayload_(inv, people, decision.response, open);
    result.outcome = decision.action === 'write' ? 'saved' : decision.action;
    return { ok: true, result: result };
  } catch (err) {
    console.error(err);
    return { ok: false, status: 500, code: err && err.btStructure ? 'structure' : 'write_failed', message: String((err && err.message) || err), retryable: true };
  } finally {
    lock.releaseLock();
  }
}

/** Escribe solo las columnas del esquema en la fila de la invitación (o agrega una fila). */
function writeResponse_(table, rowNumber, r) {
  var values = {
    invitationId: r.invitationId,
    personIds: BtRules.joinIds(r.personIds),
    status: BtRules.STATUS_LABEL[r.status],
    revision: String(r.revision),
    updatedAt: r.updatedAt,
    requestId: r.requestId,
  };
  var sheet = table.sheet;
  var width = table.width;
  var row = rowNumber ? sheet.getRange(rowNumber, 1, 1, width).getValues()[0] : new Array(width).fill('');
  // Si alguien ordenó Respuestas a mano entre la lectura y la escritura, la fila ya no es la
  // de esta invitación: se aborta (error reintentable) en lugar de pisar otra respuesta.
  if (rowNumber && String(row[table.index.invitationId]).trim().toLowerCase() !== String(r.invitationId).toLowerCase()) {
    throw new Error('La fila de la respuesta cambió de lugar durante la escritura.');
  }
  for (var k in values) if (table.index[k] !== undefined) row[table.index[k]] = values[k];
  var target = rowNumber || sheet.getLastRow() + 1;
  var range = sheet.getRange(target, 1, 1, width);
  range.setNumberFormat('@'); // texto plano: Sheets no convierte fechas, IDs ni revisiones
  range.setValues([row]);
}

/**
 * Registros de la hoja para totales y revisión. Las filas con errores de formato no se
 * cuentan (se reportan como problemas): así una fila mal capturada no altera los totales.
 */
function allRecords_(ss) {
  var rows = { invitations: invitations_(ss), people: peopleRows_(ss), responses: responseRows_(readTab_(ss, BtRules.RESPONSES_TAB)) };
  var valid = function (p) { return !p.errors.length; };
  return {
    invitations: rows.invitations.filter(valid).map(valueOf_),
    people: rows.people.filter(valid).map(valueOf_),
    responses: rows.responses.filter(valid).map(valueOf_),
    issues: BtRules.rowIssues(rows),
  };
}

function rosterIssues_(all) {
  return all.issues.concat(BtRules.checkRoster(all.invitations, all.people, all.responses, { live: true }));
}

function summary_() {
  var ss = ss_();
  var all = allRecords_(ss);
  var s = BtRules.summarize(all.invitations, all.people, all.responses);
  s.rsvpOpen = rsvpOpen_(ss);
  return { ok: true, result: { summary: s, issues: rosterIssues_(all).slice(0, 50) } };
}

function checkStructure_(ss) {
  var out = {};
  BtRules.TABS.forEach(function (tab) {
    try {
      readTab_(ss, tab);
      out[tab.name] = 'ok';
    } catch (err) {
      out[tab.name] = String(err.message || err);
    }
  });
  out[BtRules.CONFIG_TAB.name] = ss.getSheetByName(BtRules.CONFIG_TAB.name) ? 'ok' : 'Falta la pestaña Config.';
  return out;
}

// ---------------------------------------------------------------- enlaces

function newToken_(taken) {
  for (var i = 0; i < 10; i++) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
    var token = Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').slice(0, 24);
    if (BtRules.LIVE_TOKEN_RE.test(token) && !taken[token]) return token;
  }
  throw new Error('No se pudo generar un enlace único.');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BT_LOCK_MS)) throw new Error('El registro está ocupado; inténtalo de nuevo en unos segundos.');
  try {
    var out = fn();
    // Que la siguiente operación con el bloqueo ya lea estos cambios.
    SpreadsheetApp.flush();
    return out;
  } finally {
    lock.releaseLock();
  }
}

function setToken_(table, rowNumber, token) {
  var col = table.index.token;
  var cell = table.sheet.getRange(rowNumber, col + 1);
  cell.setNumberFormat('@');
  cell.setValue(token);
}

/** Genera el enlace de cada invitación activa que aún no tiene. Devuelve cuántos generó. */
function fillMissingTokens_(ss) {
  return withLock_(function () {
    var table = readTab_(ss, BtRules.INVITATIONS_TAB);
    var taken = {};
    table.rows.forEach(function (r) { if (r.data.token) taken[String(r.data.token)] = true; });
    var n = 0;
    table.rows.forEach(function (r) {
      var v = BtRules.parseInvitationRow(r.data).value;
      // No se generan enlaces para filas revocadas a propósito ni para filas de demostración o ejemplo.
      if (v.id && v.group && v.active && !v.token && !v.revoked && !BtRules.DEMO_ID_RE.test(v.id)) {
        var t = newToken_(taken);
        taken[t] = true;
        setToken_(table, r.row, t);
        n++;
      }
    });
    return n;
  });
}

/** Regenera (nuevo token) o revoca (marca "revocado", que "Generar enlaces faltantes" respeta) el enlace. */
function replaceToken_(ss, invitationId, revoke) {
  return withLock_(function () {
    var table = readTab_(ss, BtRules.INVITATIONS_TAB);
    var k = String(invitationId).toLowerCase();
    var rows = table.rows.filter(function (r) { return String(r.data.id).trim().toLowerCase() === k; });
    if (rows.length !== 1) throw new Error('No se encontró una sola invitación con el ID ' + invitationId + '.');
    var taken = {};
    table.rows.forEach(function (r) { if (r.data.token) taken[String(r.data.token)] = true; });
    var token = revoke ? BtRules.REVOKED_TOKEN : newToken_(taken);
    setToken_(table, rows[0].row, token);
    return token;
  });
}

function setRsvpOpen_(ss, open) {
  return withLock_(function () {
    var c = configRow_(ss, BtRules.CONFIG_TAB.keys.rsvpOpen.key);
    if (!c) throw new Error('Falta el ajuste confirmaciones_abiertas en la pestaña Config.');
    c.sheet.getRange(c.row, 2).setValue(open);
    return open;
  });
}

// ---------------------------------------------------------------- menú de la hoja (lo usa la dueña o el dueño del archivo)

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Boda')
    .addItem('Preparar estructura', 'btSetup')
    .addItem('Generar enlaces faltantes', 'btFillTokens')
    .addItem('Regenerar enlace de la fila seleccionada', 'btRegenerateSelected')
    .addItem('Revocar enlace de la fila seleccionada', 'btRevokeSelected')
    .addSeparator()
    .addItem('Revisar la lista', 'btCheck')
    .addItem('Actualizar resumen', 'btRefreshSummary')
    .addItem('Cerrar confirmaciones', 'btCloseRsvp')
    .addItem('Abrir confirmaciones', 'btOpenRsvp')
    .addToUi();
}

function selectedInvitationId_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (sheet.getName() !== BtRules.INVITATIONS_TAB.name) throw new Error('Selecciona una fila en la pestaña Invitaciones.');
  var table = readTab_(ss, BtRules.INVITATIONS_TAB);
  var row = sheet.getActiveRange().getRow();
  var match = table.rows.filter(function (r) { return r.row === row; })[0];
  if (!match || !match.data.id) throw new Error('La fila seleccionada no tiene id_invitacion.');
  return String(match.data.id).trim();
}

function btFillTokens() {
  var n = fillMissingTokens_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert(n ? 'Se generaron ' + n + ' enlaces.' : 'Todas las invitaciones activas ya tienen enlace.');
}

function btRegenerateSelected() {
  var ui = SpreadsheetApp.getUi();
  var id = selectedInvitationId_();
  if (ui.alert('¿Generar un enlace nuevo para ' + id + '? El anterior dejará de funcionar.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  replaceToken_(SpreadsheetApp.getActiveSpreadsheet(), id, false);
  ui.alert('Enlace nuevo generado para ' + id + '. Envíalo de nuevo a la familia.');
}

function btRevokeSelected() {
  var ui = SpreadsheetApp.getUi();
  var id = selectedInvitationId_();
  if (ui.alert('¿Revocar el enlace de ' + id + '? Dejará de funcionar hasta generar otro.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  replaceToken_(SpreadsheetApp.getActiveSpreadsheet(), id, true);
  ui.alert('Enlace de ' + id + ' revocado.');
}

function btCheck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var all = allRecords_(ss);
  var issues = rosterIssues_(all);
  refreshSummary_(ss, all);
  var text = issues.length
    ? issues.slice(0, 40).map(function (i) { return (i.severity === 'error' ? 'ERROR · ' : 'Aviso · ') + i.tab + ' ' + i.id + ': ' + i.message; }).join('\n')
    : 'Sin problemas en la lista.';
  SpreadsheetApp.getUi().alert('Revisión de la lista', text, SpreadsheetApp.getUi().ButtonSet.OK);
}

function btCloseRsvp() {
  setRsvpOpen_(SpreadsheetApp.getActiveSpreadsheet(), false);
  SpreadsheetApp.getUi().alert('Confirmaciones cerradas. Los invitados verán su respuesta, pero no podrán cambiarla.');
}

function btOpenRsvp() {
  setRsvpOpen_(SpreadsheetApp.getActiveSpreadsheet(), true);
  SpreadsheetApp.getUi().alert('Confirmaciones abiertas.');
}

/**
 * Crea las pestañas que falten con sus encabezados, formatos, validaciones y protecciones.
 * No borra ni reordena datos existentes. Proteger celdas NO sustituye los permisos del
 * archivo: la hoja debe seguir compartida solo con los novios.
 */
function btSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  BtRules.TABS.forEach(function (tab) {
    var sheet = ss.getSheetByName(tab.name) || ss.insertSheet(tab.name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, tab.columns.length).setValues([tab.columns.map(function (c) { return c.header; })]);
    }
    sheet.setFrozenRows(1);
    var table = readTab_(ss, tab);
    var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
    tab.columns.forEach(function (col) {
      var idx = table.index[col.key];
      if (idx === undefined) return;
      var range = sheet.getRange(2, idx + 1, maxRows, 1);
      if (col.key !== 'seats') range.setNumberFormat('@');
      // "activa" es sí/no (vacío cuenta como sí): una fila nueva no queda inactiva por accidente.
      if (col.key === 'active') range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['sí', 'no'], true).setAllowInvalid(false).build());
      if (col.key === 'side') range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(BtRules.SIDES, true).setAllowInvalid(false).build());
      if (col.key === 'seats') range.setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, BtRules.MAX_SEATS).setAllowInvalid(false).build());
      sheet.getRange(1, idx + 1).setNote(col.help);
      if (col.technical) range.protect().setDescription('Columna técnica: la escribe el script (' + col.header + ')').setWarningOnly(true);
    });
    if (tab.name === BtRules.RESPONSES_TAB.name) sheet.protect().setDescription('Respuestas: las escribe el script').setWarningOnly(true);
  });
  var config = ss.getSheetByName(BtRules.CONFIG_TAB.name) || ss.insertSheet(BtRules.CONFIG_TAB.name);
  var keys = BtRules.CONFIG_TAB.keys;
  [
    [keys.rsvpOpen.key, true],
    [keys.publicUrl.key, ''],
    [keys.schemaVersion.key, String(BtRules.SHEETS_SCHEMA_VERSION)],
  ].forEach(function (kv) {
    if (!configRow_(ss, kv[0])) config.appendRow(kv);
  });
  var open = configRow_(ss, keys.rsvpOpen.key);
  config.getRange(open.row, 2).insertCheckboxes();
  setupLinkFormula_(ss);
  refreshSummary_(ss);
  SpreadsheetApp.getUi().alert('Estructura lista. Escribe la dirección pública en Config → url_publica y usa "Generar enlaces faltantes".');
}

function colLetter_(index) {
  var n = index + 1;
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** enlace = url_publica + "/i/" + token, calculado (no guardado aparte). */
function setupLinkFormula_(ss) {
  var table = readTab_(ss, BtRules.INVITATIONS_TAB);
  if (table.index.link === undefined || table.index.token === undefined) return;
  var url = configRow_(ss, BtRules.CONFIG_TAB.keys.publicUrl.key);
  var t = colLetter_(table.index.token);
  // Sintaxis en-US de Apps Script: "," separa argumentos y ";" separa filas del arreglo.
  // Solo tokens de 24 caracteres: una fila sin enlace o "revocado" queda vacía.
  var formula = '={"enlace";ARRAYFORMULA(IF(LEN(' + t + '2:' + t + ')<>24,"",Config!$B$' + url.row + '&"/i/"&' + t + '2:' + t + '))}';
  table.sheet.getRange(1, table.index.link + 1).setFormula(formula);
}

/**
 * Pestaña Resumen: valores calculados con las mismas reglas que el panel (BtRules.summarize),
 * desde el registro vigente. No es otra copia de las respuestas: se recalcula con el menú.
 */
function refreshSummary_(ss, all) {
  all = all || allRecords_(ss);
  var s = BtRules.summarize(all.invitations, all.people, all.responses);
  var sheet = ss.getSheetByName(BtRules.SUMMARY_TAB) || ss.insertSheet(BtRules.SUMMARY_TAB);
  var rows = [
    ['Indicador', 'Valor'],
    ['Invitaciones activas', s.invitations],
    ['Invitaciones sin cupo asignado', s.incomplete],
    ['Cupo asignado', s.seatsAssigned],
    ['Personas autorizadas activas', s.people],
    ['Invitaciones que asistirán', s.attending],
    ['Invitaciones que no asistirán', s.declined],
    ['Invitaciones sin respuesta', s.pending],
    ['Personas confirmadas', s.attendingPeople],
    ['Lugares sin usar en respuestas (deciden los novios)', s.unusedSeats],
    ['Filas con problemas (ver "Revisar la lista")', all.issues.length],
    ['Actualizado', nowIso_()],
  ];
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(rows.length + 2, 1).setValue('Calculado desde Invitaciones, Personas y Respuestas con las reglas del servidor. Menú Boda → Actualizar resumen.');
}

function btRefreshSummary() {
  refreshSummary_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert('Resumen actualizado.');
}
