// ARCHIVO GENERADO por `npm run sheets:build`. No lo edites aquí: cambia shared/rsvp-rules.ts,
// shared/sheets-schema.ts o apps-script/src/Code.js y vuelve a generarlo.

// ---- BtRules: reglas compartidas con el servidor ----
"use strict";
var BtRules = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key2 of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key2) && key2 !== except)
          __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // apps-script/src/rules-entry.ts
  var rules_entry_exports = {};
  __export(rules_entry_exports, {
    ACTIVE_ERROR: () => ACTIVE_ERROR,
    CONFIG_TAB: () => CONFIG_TAB,
    CONNECTOR_MAX_SKEW_MS: () => CONNECTOR_MAX_SKEW_MS,
    CONNECTOR_OPS: () => CONNECTOR_OPS,
    CONNECTOR_VERSION: () => CONNECTOR_VERSION,
    DEMO_ID_RE: () => DEMO_ID_RE,
    DEMO_TOKEN_RE: () => DEMO_TOKEN_RE,
    ID_RE: () => ID_RE,
    INVITATIONS_TAB: () => INVITATIONS_TAB,
    LIVE_TOKEN_RE: () => LIVE_TOKEN_RE,
    MAX_PEOPLE: () => MAX_PEOPLE,
    MAX_SEATS: () => MAX_SEATS,
    NOT_FOUND_MESSAGE: () => NOT_FOUND_MESSAGE,
    PEOPLE_TAB: () => PEOPLE_TAB,
    REQUEST_ID_RE: () => REQUEST_ID_RE,
    RESPONSES_TAB: () => RESPONSES_TAB,
    REVIEW_MESSAGE: () => REVIEW_MESSAGE,
    REVOKED_TOKEN: () => REVOKED_TOKEN,
    RULES_VERSION: () => RULES_VERSION,
    SHEETS_SCHEMA_VERSION: () => SHEETS_SCHEMA_VERSION,
    SIDES: () => SIDES,
    STATUS_LABEL: () => STATUS_LABEL,
    SUMMARY_TAB: () => SUMMARY_TAB,
    TABS: () => TABS,
    checkRoster: () => checkRoster,
    decideRsvp: () => decideRsvp,
    headersOf: () => headersOf,
    invitationBlockers: () => invitationBlockers,
    joinIds: () => joinIds,
    naturalCompare: () => naturalCompare,
    normalizePhone: () => normalizePhone,
    parseBool: () => parseBool,
    parseInvitationRow: () => parseInvitationRow,
    parsePersonRow: () => parsePersonRow,
    parseResponseRow: () => parseResponseRow,
    parseRsvpRequest: () => parseRsvpRequest,
    parseStatusLabel: () => parseStatusLabel,
    rowByKey: () => rowByKey,
    rowIssues: () => rowIssues,
    signingString: () => signingString,
    sortPeopleById: () => sortPeopleById,
    splitIds: () => splitIds,
    summarize: () => summarize,
    toGuestView: () => toGuestView
  });

  // shared/rsvp-rules.ts
  var RULES_VERSION = 1;
  var MAX_SEATS = 30;
  var MAX_PEOPLE = 30;
  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
  var LIVE_TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;
  var DEMO_TOKEN_RE = /^demo_[A-Za-z0-9_-]{24}$/;
  var REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
  var DEMO_ID_RE = /^(demo|ejemplo)[-_]/i;
  var REVOKED_TOKEN = "revocado";
  var SIDES = ["novia", "novio", "ambos"];
  var fail = (status, code, message) => ({ ok: false, status, code, message });
  var NOT_FOUND_MESSAGE = "No encontramos esta invitación.";
  var key = (id) => id.toLowerCase();
  var RSVP_KEYS = ["status", "personIds", "expectedRevision", "requestId"];
  function parseRsvpRequest(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "invalid_request", "La solicitud no es válida.");
    const b = body;
    const extra = Object.keys(b).filter((k) => RSVP_KEYS.indexOf(k) < 0);
    if (extra.length) {
      return fail(400, "forbidden_fields", `La confirmación solo indica quiénes asistirán; no acepta los campos: ${extra.join(", ")}.`);
    }
    if (b.status !== "attending" && b.status !== "declined") return fail(400, "invalid_status", "Indica si asistirán o no.");
    if (!Array.isArray(b.personIds) || b.personIds.length > MAX_PEOPLE) {
      return fail(400, "invalid_people", "La selección de personas no es válida.");
    }
    const ids = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of b.personIds) {
      if (typeof raw !== "string" || !ID_RE.test(raw)) return fail(400, "invalid_people", "La selección de personas no es válida.");
      if (seen.has(key(raw))) return fail(400, "duplicate_person", "Una persona aparece más de una vez en la selección.");
      seen.add(key(raw));
      ids.push(raw);
    }
    if (b.status === "declined" && ids.length) {
      return fail(400, "declined_with_people", "Si nadie podrá asistir, no selecciones personas.");
    }
    if (b.status === "attending" && !ids.length) {
      return fail(400, "no_people_selected", "Selecciona al menos a una persona que asistirá.");
    }
    const rev = b.expectedRevision;
    if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0 || rev > 1e9) {
      return fail(400, "invalid_revision", "Vuelve a abrir tu invitación e inténtalo de nuevo.");
    }
    if (typeof b.requestId !== "string" || !REQUEST_ID_RE.test(b.requestId)) {
      return fail(400, "invalid_request_id", "La solicitud no es válida.");
    }
    return { ok: true, value: { status: b.status, personIds: ids, expectedRevision: rev, requestId: b.requestId } };
  }
  var sameIds = (a, b) => {
    if (a.length !== b.length) return false;
    const s = new Set(a.map(key));
    return b.every((id) => s.has(key(id)));
  };
  function decideRsvp(ctx, req) {
    var _a;
    const { invitation, current } = ctx;
    if (!invitation.active) return fail(404, "not_found", NOT_FOUND_MESSAGE);
    if (current && current.requestId === req.requestId) {
      if (current.status === req.status && sameIds(current.personIds, req.personIds)) return { ok: true, action: "replay", response: current };
      return fail(409, "request_id_reused", "Esta solicitud ya se usó con otra selección. Revisa tu respuesta y vuelve a guardarla.");
    }
    if (!ctx.rsvpOpen) return fail(409, "rsvp_closed", "La confirmación de asistencia ya está cerrada.");
    if (invitation.seats === null) {
      return fail(409, "seats_unassigned", "Esta invitación aún no tiene lugares asignados.");
    }
    const own = ctx.people.filter((p) => key(p.invitationId) === key(invitation.id));
    const byKey = new Map(own.map((p) => [key(p.id), p]));
    const selected = [];
    for (const id of req.personIds) {
      const person = byKey.get(key(id));
      if (!person) return fail(400, "unknown_person", "La selección incluye a alguien que no forma parte de esta invitación.");
      if (!person.active) return fail(400, "inactive_person", "La selección incluye a alguien que ya no está en esta invitación.");
      selected.push(person);
    }
    if (selected.length > invitation.seats) {
      const s = invitation.seats;
      return fail(
        400,
        "over_capacity",
        `Esta invitación tiene ${s} ${s === 1 ? "lugar" : "lugares"}; no es posible confirmar a ${selected.length} personas.`
      );
    }
    const order = own.map((p) => key(p.id));
    const personIds = selected.sort((a, b) => order.indexOf(key(a.id)) - order.indexOf(key(b.id))).map((p) => p.id);
    if (current && current.status === req.status && sameIds(current.personIds, personIds)) {
      return { ok: true, action: "unchanged", response: current };
    }
    const currentRevision = current ? current.revision : (_a = ctx.baseRevision) != null ? _a : 0;
    if (req.expectedRevision !== currentRevision) {
      return {
        ...fail(409, "conflict", "Esta invitación se actualizó desde otro dispositivo mientras la revisabas."),
        current
      };
    }
    return {
      ok: true,
      action: "write",
      response: {
        invitationId: invitation.id,
        personIds,
        status: req.status,
        revision: currentRevision + 1,
        updatedAt: ctx.now,
        requestId: req.requestId
      }
    };
  }
  function toGuestView(invitation, people, current, rsvpOpen, baseRevision = 0) {
    const active = people.filter((p) => p.active);
    const activeKeys = new Set(active.map((p) => key(p.id)));
    const closedReason = invitation.seats === null ? "seats_unassigned" : !active.length ? "no_people" : !rsvpOpen ? "rsvp_closed" : null;
    const selected = current ? current.personIds.filter((id) => activeKeys.has(key(id))) : [];
    return {
      name: invitation.group,
      seats: invitation.seats,
      people: active.map((p) => ({ id: p.id, name: p.name })),
      revision: current ? current.revision : baseRevision,
      response: current ? { status: current.status, personIds: selected, attending: current.status === "attending" ? selected.length : 0, updatedAt: current.updatedAt } : null,
      canRespond: closedReason === null,
      closedReason
    };
  }
  function normalizePhone(raw) {
    if (!raw) return null;
    let d = String(raw).replace(/\D/g, "");
    if (!d) return null;
    if (d.length === 10) d = "52" + d;
    else if (d.length === 13 && d.indexOf("521") === 0) d = "52" + d.slice(3);
    if (d.length < 11 || d.length > 15) return null;
    return d;
  }
  var text = (v) => v === null || v === void 0 ? "" : String(v).trim();
  var stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  function parseBool(v, fallback) {
    if (v === true || v === false) return v;
    const t = stripAccents(text(v).toLowerCase());
    if (!t) return fallback;
    if (["si", "true", "verdadero", "1", "x", "activa", "activo"].indexOf(t) >= 0) return true;
    if (["no", "false", "falso", "0", "inactiva", "inactivo"].indexOf(t) >= 0) return false;
    return null;
  }
  var ACTIVE_ERROR = 'La columna "activa" debe ser sí o no.';
  function parseInvitationRow(raw) {
    const errors = [];
    const warnings = [];
    const blocking = [];
    const block = (msg) => {
      errors.push(msg);
      blocking.push(msg);
    };
    const id = text(raw.id);
    const group = text(raw.group).replace(/\s+/g, " ");
    const contact = text(raw.contact).replace(/\s+/g, " ");
    const sideRaw = stripAccents(text(raw.side).toLowerCase());
    const phoneRaw = text(raw.phone);
    const notes = text(raw.notes);
    const tokenRaw = text(raw.token);
    if (!id) block("Falta el ID de la invitación.");
    else if (!ID_RE.test(id)) block('El ID solo admite letras, números, "-" y "_" (máximo 40).');
    if (!group) block("Falta el nombre del grupo.");
    else if (group.length > 120) block("El nombre del grupo es demasiado largo (máximo 120 caracteres).");
    if (contact.length > 120) errors.push("El contacto principal es demasiado largo (máximo 120 caracteres).");
    let side = null;
    if (sideRaw) {
      if (SIDES.indexOf(sideRaw) >= 0) side = sideRaw;
      else errors.push(`El lado "${text(raw.side)}" no es válido; usa novia, novio o ambos.`);
    }
    let phone = null;
    if (phoneRaw) {
      phone = normalizePhone(phoneRaw);
      if (!phone) errors.push(`El teléfono "${phoneRaw}" no es válido (usa 10 dígitos o formato internacional).`);
    }
    let seats = null;
    const seatsText = text(raw.seats);
    if (!seatsText) warnings.push("Sin cupo asignado: no podrá confirmar hasta asignarlo.");
    else {
      const n = typeof raw.seats === "number" ? raw.seats : Number(seatsText);
      if (!Number.isInteger(n)) block("El cupo debe ser un número entero.");
      else if (n < 1 || n > MAX_SEATS) block(`El cupo debe estar entre 1 y ${MAX_SEATS}.`);
      else seats = n;
    }
    const active = parseBool(raw.active, true);
    if (active === null) block(ACTIVE_ERROR);
    const revoked = tokenRaw.toLowerCase() === REVOKED_TOKEN;
    if (tokenRaw && !revoked && !LIVE_TOKEN_RE.test(tokenRaw) && !DEMO_TOKEN_RE.test(tokenRaw)) block("El token no tiene el formato esperado.");
    if (notes.length > 500) errors.push("Las notas son demasiado largas (máximo 500 caracteres).");
    return {
      // Un valor de "activa" no reconocido cuenta como inactiva (y se reporta como error).
      value: { id, group, side, contact: contact || null, phone, seats, active: active === true, token: revoked ? null : tokenRaw || null, notes: notes || null, revoked },
      errors,
      warnings,
      blocking
    };
  }
  function parsePersonRow(raw) {
    const errors = [];
    const id = text(raw.id);
    const invitationId = text(raw.invitationId);
    const name = text(raw.name).replace(/\s+/g, " ");
    if (!id) errors.push("Falta el ID de la persona.");
    else if (!ID_RE.test(id)) errors.push('El ID de persona solo admite letras, números, "-" y "_" (máximo 40).');
    if (!invitationId) errors.push("Falta el ID de invitación de la persona.");
    if (!name) errors.push("Falta el nombre autorizado.");
    else if (name.length > 120) errors.push("El nombre es demasiado largo (máximo 120 caracteres).");
    const active = parseBool(raw.active, true);
    if (active === null) errors.push(ACTIVE_ERROR);
    return { value: { id, invitationId, name, active: active === true }, errors, warnings: [] };
  }
  function sortPeopleById(people) {
    return people.slice().sort((a, b) => naturalCompare(a.id, b.id));
  }
  function naturalCompare(a, b) {
    var _a, _b;
    const ca = (_a = a.toLowerCase().match(/\d+|\D+/g)) != null ? _a : [];
    const cb = (_b = b.toLowerCase().match(/\d+|\D+/g)) != null ? _b : [];
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      const x = ca[i];
      const y = cb[i];
      if (x === y) continue;
      const nx = /^\d/.test(x) && /^\d/.test(y);
      if (nx) {
        const d = Number(x) - Number(y);
        if (d) return d;
        continue;
      }
      return x < y ? -1 : 1;
    }
    return ca.length - cb.length;
  }
  var STATUS_LABEL = { attending: "asistirá", declined: "no asistirá" };
  function parseStatusLabel(v) {
    const t = stripAccents(text(v).toLowerCase());
    if (t === "asistira" || t === "attending") return "attending";
    if (t === "no asistira" || t === "declined") return "declined";
    return null;
  }
  var joinIds = (ids) => ids.join(", ");
  var splitIds = (v) => text(v).split(/[,;\s]+/).filter(Boolean);
  function parseResponseRow(raw) {
    const errors = [];
    const invitationId = text(raw.invitationId);
    const status = parseStatusLabel(raw.status);
    const personIds = splitIds(raw.personIds);
    const revision = Number(text(raw.revision));
    if (!invitationId) errors.push("Falta el ID de invitación de la respuesta.");
    if (!status) errors.push('El estado debe ser "asistirá" o "no asistirá".');
    if (!Number.isInteger(revision) || revision < 1) errors.push("La revisión debe ser un entero mayor que 0.");
    if (status === "declined" && personIds.length) errors.push('Una respuesta "no asistirá" no lleva personas seleccionadas.');
    if (status === "attending" && !personIds.length) errors.push('Una respuesta "asistirá" necesita personas seleccionadas.');
    return {
      value: {
        invitationId,
        personIds,
        status: status != null ? status : "declined",
        revision: Number.isInteger(revision) ? revision : 0,
        updatedAt: text(raw.updatedAt),
        requestId: text(raw.requestId)
      },
      errors,
      warnings: []
    };
  }
  function checkRoster(invitations, people, responses, opts) {
    var _a, _b;
    const issues = [];
    const add = (severity, tab, id, message) => issues.push({ severity, tab, id, message });
    const invById = /* @__PURE__ */ new Map();
    const tokens = /* @__PURE__ */ new Map();
    const phones = /* @__PURE__ */ new Map();
    for (const inv of invitations) {
      if (invById.has(key(inv.id))) add("error", "Invitaciones", inv.id, "ID de invitación repetido.");
      else invById.set(key(inv.id), inv);
      if (opts.live && DEMO_ID_RE.test(inv.id)) add("error", "Invitaciones", inv.id, "Este ID es de demostración; no debe estar en la lista real.");
      if (inv.token) {
        if (opts.live && !LIVE_TOKEN_RE.test(inv.token)) add("error", "Invitaciones", inv.id, "El token no es un enlace real válido (¿viene de la demostración?).");
        const other = tokens.get(inv.token);
        if (other) add("error", "Invitaciones", inv.id, `Token repetido (también en ${other}).`);
        else tokens.set(inv.token, inv.id);
      } else if (inv.revoked) add("warning", "Invitaciones", inv.id, "Enlace revocado: genera uno nuevo con el menú si corresponde.");
      else if (inv.active) add("warning", "Invitaciones", inv.id, "Sin enlace personal todavía.");
      if (inv.phone) {
        const other = phones.get(inv.phone);
        if (other) add("warning", "Invitaciones", inv.id, `Mismo teléfono que ${other}; se mantienen como invitaciones distintas.`);
        else phones.set(inv.phone, inv.id);
      }
    }
    const personIds = /* @__PURE__ */ new Set();
    const activeCount = /* @__PURE__ */ new Map();
    for (const p of people) {
      if (personIds.has(key(p.id))) add("error", "Personas", p.id, "ID de persona repetido.");
      personIds.add(key(p.id));
      if (!invById.has(key(p.invitationId))) add("error", "Personas", p.id, `La invitación ${p.invitationId} no existe.`);
      if (p.active) activeCount.set(key(p.invitationId), ((_a = activeCount.get(key(p.invitationId))) != null ? _a : 0) + 1);
    }
    for (const inv of invById.values()) {
      if (!inv.active) continue;
      const n = (_b = activeCount.get(key(inv.id))) != null ? _b : 0;
      if (!n) add("warning", "Invitaciones", inv.id, "Sin personas autorizadas: no podrá confirmar asistencia.");
      else if (inv.seats !== null && n > inv.seats) {
        add("warning", "Invitaciones", inv.id, `${n} personas autorizadas y cupo de ${inv.seats}: solo podrán confirmar ${inv.seats}.`);
      } else if (inv.seats !== null && n < inv.seats) {
        add("warning", "Invitaciones", inv.id, `Cupo de ${inv.seats} y ${n === 1 ? "1 persona autorizada" : `${n} personas autorizadas`}: el cupo extra no se puede usar (la invitación es intransferible).`);
      }
    }
    const responded = /* @__PURE__ */ new Set();
    const personById = new Map(people.map((p) => [key(p.id), p]));
    for (const r of responses) {
      if (responded.has(key(r.invitationId))) add("error", "Respuestas", r.invitationId, "Hay más de una respuesta para esta invitación.");
      responded.add(key(r.invitationId));
      const inv = invById.get(key(r.invitationId));
      if (!inv) {
        add("error", "Respuestas", r.invitationId, "La invitación de esta respuesta no existe.");
        continue;
      }
      for (const pid of r.personIds) {
        const p = personById.get(key(pid));
        if (!p || key(p.invitationId) !== key(inv.id)) add("error", "Respuestas", r.invitationId, `La persona ${pid} no pertenece a esta invitación.`);
        else if (!p.active) add("warning", "Respuestas", r.invitationId, `La persona ${pid} está confirmada pero ya no está activa.`);
      }
      if (inv.seats !== null && r.personIds.length > inv.seats) {
        add("error", "Respuestas", r.invitationId, `Confirma ${r.personIds.length} personas con cupo de ${inv.seats}.`);
      }
    }
    return issues;
  }
  var REVIEW_MESSAGE = "Tu invitación tiene un detalle pendiente de revisar. Escríbenos y lo resolvemos.";
  function invitationBlockers(target, rows) {
    var _a;
    const out = [];
    const id = key(target.value.id);
    const targetErrors = (_a = target.blocking) != null ? _a : target.errors;
    if (targetErrors.length) out.push(`Invitación ${target.value.id}: ${targetErrors.join(" ")}`);
    if (rows.invitations.filter((r) => key(r.value.id) === id).length > 1) out.push(`ID de invitación repetido: ${target.value.id}.`);
    const own = rows.people.filter((r) => key(r.value.invitationId) === id);
    for (const p of own) {
      if (p.errors.length) out.push(`Persona ${p.value.id || "(sin ID)"}: ${p.errors.join(" ")}`);
      const sameId = rows.people.filter((r) => key(r.value.id) === key(p.value.id));
      if (sameId.length > 1) out.push(`ID de persona repetido: ${p.value.id}.`);
    }
    const responses = rows.responses.filter((r) => key(r.value.invitationId) === id);
    if (responses.length > 1) out.push("Hay más de una respuesta para esta invitación.");
    else if (responses.length === 1 && responses[0].errors.length) out.push(`Respuesta: ${responses[0].errors.join(" ")}`);
    return out;
  }
  function rowIssues(rows) {
    const issues = [];
    const push = (tab, id, errors) => {
      for (const message of errors) issues.push({ severity: "error", tab, id: id || "(sin ID)", message });
    };
    rows.invitations.forEach((r) => push("Invitaciones", r.value.id, r.errors));
    rows.people.forEach((r) => push("Personas", r.value.id, r.errors));
    rows.responses.forEach((r) => push("Respuestas", r.value.invitationId, r.errors));
    return issues;
  }
  function summarize(invitations, people, responses) {
    const active = invitations.filter((i) => i.active);
    const activeIds = new Set(active.map((i) => key(i.id)));
    const activePeople = new Map(people.filter((p) => p.active && activeIds.has(key(p.invitationId))).map((p) => [key(p.id), p]));
    const byInv = new Map(responses.map((r) => [key(r.invitationId), r]));
    const s = { invitations: active.length, incomplete: 0, seatsAssigned: 0, people: activePeople.size, attendingPeople: 0, attending: 0, declined: 0, pending: 0, unusedSeats: 0 };
    for (const inv of active) {
      if (inv.seats === null) s.incomplete++;
      else s.seatsAssigned += inv.seats;
      const r = byInv.get(key(inv.id));
      if (!r) {
        s.pending++;
        continue;
      }
      const n = r.status === "attending" ? r.personIds.filter((id) => {
        var _a;
        return ((_a = activePeople.get(key(id))) == null ? void 0 : _a.invitationId.toLowerCase()) === key(inv.id);
      }).length : 0;
      if (r.status === "attending") {
        s.attending++;
        s.attendingPeople += n;
      } else s.declined++;
      if (inv.seats !== null) s.unusedSeats += Math.max(0, inv.seats - n);
    }
    return s;
  }
  var CONNECTOR_OPS = ["ping", "getInvitation", "saveResponse", "summary"];
  var CONNECTOR_VERSION = 1;
  var CONNECTOR_MAX_SKEW_MS = 5 * 6e4;
  var signingString = (parts) => parts.map(String).join("\n");

  // shared/sheets-schema.ts
  var SHEETS_SCHEMA_VERSION = 1;
  var INVITATIONS_TAB = {
    name: "Invitaciones",
    columns: [
      { key: "id", header: "id_invitacion", required: true, help: "ID estable de la invitación (p. ej. INV-001). No se reutiliza ni se cambia. Los IDs EJEMPLO- y DEMO- nunca se atienden." },
      { key: "side", header: "lado", help: "novia, novio o ambos." },
      { key: "group", header: "grupo", required: true, help: "Nombre de la invitación tal como lo verá la familia." },
      { key: "contact", header: "contacto_principal", help: "Persona a quien se le envía el enlace (uso interno)." },
      { key: "phone", header: "telefono", help: "10 dígitos o formato internacional (uso interno, nunca se muestra)." },
      { key: "seats", header: "cupo", help: "Lugares asignados (1 a 30). Vacío = pendiente; no puede confirmar." },
      { key: "active", header: "activa", help: 'sí o no (vacío = sí). "no" desactiva la invitación y su enlace.' },
      { key: "token", header: "token", technical: true, help: 'Lo genera el menú Boda ("revocado" = enlace anulado a propósito). Quien tenga el enlace puede responder por esta invitación.' },
      { key: "link", header: "enlace", technical: true, help: "Fórmula: url_publica + /i/ + token. Para copiar y enviar." },
      { key: "notes", header: "notas", help: "Notas internas (nunca se muestran al invitado)." }
    ]
  };
  var PEOPLE_TAB = {
    name: "Personas",
    columns: [
      { key: "id", header: "id_persona", required: true, help: "ID estable de la persona (p. ej. INV-001-P1)." },
      { key: "invitationId", header: "id_invitacion", required: true, help: "ID de la invitación a la que pertenece." },
      { key: "name", header: "nombre", required: true, help: "Nombre autorizado, como aparecerá en la confirmación." },
      { key: "active", header: "activa", help: 'sí o no (vacío = sí). "no" la quita de la confirmación sin borrar su ID.' }
    ]
  };
  var RESPONSES_TAB = {
    name: "Respuestas",
    columns: [
      { key: "invitationId", header: "id_invitacion", required: true, technical: true, help: "Una sola fila (respuesta vigente) por invitación." },
      { key: "personIds", header: "personas_seleccionadas", technical: true, help: "IDs de persona separados por coma." },
      { key: "status", header: "estado", technical: true, help: "asistirá o no asistirá." },
      { key: "revision", header: "revision", technical: true, help: "Sube en 1 con cada cambio; evita sobrescrituras silenciosas." },
      { key: "updatedAt", header: "fecha_hora", technical: true, help: "Fecha y hora del último cambio (America/Mexico_City)." },
      { key: "requestId", header: "id_solicitud", technical: true, help: "Identificador de la solicitud que la guardó (reintentos sin duplicar)." }
    ]
  };
  var CONFIG_TAB = {
    name: "Config",
    keys: {
      rsvpOpen: { key: "confirmaciones_abiertas", help: "Casilla. Desmarcar cierra las confirmaciones (p. ej. durante un cambio sensible)." },
      publicUrl: { key: "url_publica", help: 'Dirección pública de la invitación, sin "/" final.' },
      schemaVersion: { key: "version_estructura", help: "No editar." }
    }
  };
  var SUMMARY_TAB = "Resumen";
  var TABS = [INVITATIONS_TAB, PEOPLE_TAB, RESPONSES_TAB];
  var headersOf = (tab) => tab.columns.map((c) => c.header);
  function rowByKey(tab, byHeader) {
    const out = {};
    for (const c of tab.columns) out[c.key] = byHeader[c.header];
    return out;
  }
  return __toCommonJS(rules_entry_exports);
})();

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
  // Desactivada a propósito ("no"): no existe para el invitado, aunque la hoja tenga otros detalles.
  if (!inv.active && target.errors.indexOf(BtRules.ACTIVE_ERROR) < 0) return { error: NOT_FOUND };
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
  var current = own.length ? own[0].value : null;
  // Si la fila de la respuesta se borró a mano, la revisión sigue después de la última escrita:
  // un teléfono con la vista anterior recibe conflicto en vez de sobrescribir.
  var last = revisionFloor_(inv.id);
  var baseRevision = current ? current.revision : last ? last + 1 : 0;
  return { inv: inv, people: people, table: table, row: own.length ? own[0].row : null, current: current, baseRevision: baseRevision };
}

/** Última revisión escrita por invitación (propiedades del script, clave rev:<id>). */
function revisionFloor_(invitationId) {
  return Number(PropertiesService.getScriptProperties().getProperty('rev:' + String(invitationId).toLowerCase())) || 0;
}

function raiseRevisionFloor_(invitationId, revision) {
  if (!(revision > revisionFloor_(invitationId))) return;
  PropertiesService.getScriptProperties().setProperty('rev:' + String(invitationId).toLowerCase(), String(revision));
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

function guestPayload_(inv, people, response, open, baseRevision) {
  // Solo lo necesario para esta invitación: sin teléfono, notas, lado ni contacto.
  return { invitation: { group: inv.group, seats: inv.seats }, people: activePeople_(people), response: response, rsvpOpen: open, baseRevision: baseRevision || 0 };
}

// ---------------------------------------------------------------- operaciones

function getInvitation_(token) {
  if (typeof token !== 'string' || !BtRules.LIVE_TOKEN_RE.test(token)) return NOT_FOUND;
  try {
    var ss = ss_();
    var ctx = loadContext_(ss, token);
    if (ctx.error) return ctx.error;
    return { ok: true, result: guestPayload_(ctx.inv, ctx.people, ctx.current, rsvpOpen_(ss), ctx.baseRevision) };
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
      { invitation: { id: inv.id, seats: inv.seats, active: inv.active }, people: people, current: current, rsvpOpen: open, now: nowIso_(), baseRevision: ctx.baseRevision },
      parsed.value,
    );
    if (!decision.ok) {
      if (decision.code === 'conflict') {
        return { ok: false, status: 409, code: 'conflict', message: decision.message, current: guestPayload_(inv, people, current, open, ctx.baseRevision) };
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
      raiseRevisionFloor_(inv.id, decision.response.revision);
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
  // Una invitación con un detalle menor (teléfono, lado, notas) se sigue atendiendo, así que también cuenta.
  var servable = function (p) { return !(p.blocking || p.errors).length; };
  return {
    invitations: rows.invitations.filter(servable).map(valueOf_),
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
  // Respuestas capturadas a mano: su revisión también cuenta como la última escrita.
  all.responses.forEach(function (r) { raiseRevisionFloor_(r.invitationId, r.revision); });
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
