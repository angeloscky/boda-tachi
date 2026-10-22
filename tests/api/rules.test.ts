import { describe, expect, it } from 'vitest';
import {
  checkRoster,
  decideRsvp,
  inReviewIssue,
  invitationBlockers,
  invitationsInReview,
  parseInvitationRow,
  parsePersonRow,
  parseResponseRow,
  parseRsvpRequest,
  rowIssues,
  summarize,
  toGuestView,
  type PersonRecord,
  type ResponseRecord,
} from '../../shared/rsvp-rules.js';

const people: PersonRecord[] = [
  { id: 'F1-P1', invitationId: 'F1', name: 'Ana', active: true },
  { id: 'F1-P2', invitationId: 'F1', name: 'Luis', active: true },
  { id: 'F1-P3', invitationId: 'F1', name: 'Sara', active: true },
  { id: 'F1-P4', invitationId: 'F1', name: 'Tomás', active: false },
];
const ctx = (over: Partial<Parameters<typeof decideRsvp>[0]> = {}) => ({
  invitation: { id: 'F1', seats: 4, active: true },
  people,
  current: null as ResponseRecord | null,
  rsvpOpen: true,
  now: '2027-01-01T10:00:00-06:00',
  ...over,
});
const req = (personIds: string[], over: Record<string, unknown> = {}) => {
  const r = parseRsvpRequest({ status: personIds.length ? 'attending' : 'declined', personIds, expectedRevision: 0, requestId: 'solicitud-1', ...over });
  if (!r.ok) throw new Error(r.code);
  return r.value;
};

describe('reglas de confirmación (compartidas con Apps Script)', () => {
  it('rechaza campos administrativos y cantidades enviadas por el navegador', () => {
    for (const extra of [{ seats: 9 }, { attending: 2 }, { adults: 2 }, { name: 'x' }, { phone: '1' }, { invitationId: 'F2' }]) {
      const r = parseRsvpRequest({ status: 'attending', personIds: ['F1-P1'], expectedRevision: 0, requestId: 'solicitud-1', ...extra });
      expect(r.ok, JSON.stringify(extra)).toBe(false);
      expect(!r.ok && r.code).toBe('forbidden_fields');
    }
  });

  it('valida forma: duplicados, IDs inventados, coherencia de "no asistirán"', () => {
    const bad: [unknown, string][] = [
      [{ status: 'attending', personIds: ['F1-P1', 'f1-p1'], expectedRevision: 0, requestId: 'solicitud-1' }, 'duplicate_person'],
      [{ status: 'attending', personIds: ['<script>'], expectedRevision: 0, requestId: 'solicitud-1' }, 'invalid_people'],
      [{ status: 'attending', personIds: [], expectedRevision: 0, requestId: 'solicitud-1' }, 'no_people_selected'],
      [{ status: 'declined', personIds: ['F1-P1'], expectedRevision: 0, requestId: 'solicitud-1' }, 'declined_with_people'],
      [{ status: 'maybe', personIds: [], expectedRevision: 0, requestId: 'solicitud-1' }, 'invalid_status'],
      [{ status: 'declined', personIds: [], expectedRevision: -1, requestId: 'solicitud-1' }, 'invalid_revision'],
      [{ status: 'declined', personIds: [], expectedRevision: 0, requestId: 'x' }, 'invalid_request_id'],
      [[], 'invalid_request'],
    ];
    for (const [body, code] of bad) {
      const r = parseRsvpRequest(body);
      expect(!r.ok && r.code, JSON.stringify(body)).toBe(code);
    }
  });

  it('2 de 4 seleccionadas: escribe 2 asistentes y el cupo sigue en 4', () => {
    const d = decideRsvp(ctx(), req(['F1-P2', 'F1-P1']));
    expect(d.ok && d.action).toBe('write');
    if (d.ok) expect(d.response).toMatchObject({ personIds: ['F1-P1', 'F1-P2'], status: 'attending', revision: 1 });
    const view = toGuestView({ group: 'F1', seats: 4 }, people, d.ok ? d.response : null, true);
    expect(view.seats).toBe(4);
    expect(view.response?.attending).toBe(2);
  });

  it('rechaza personas ajenas, inactivas y selecciones por encima del cupo', () => {
    expect(decideRsvp(ctx(), req(['F2-P1']))).toMatchObject({ ok: false, code: 'unknown_person' });
    expect(decideRsvp(ctx(), req(['F1-P4']))).toMatchObject({ ok: false, code: 'inactive_person' });
    expect(decideRsvp(ctx({ invitation: { id: 'F1', seats: 2, active: true } }), req(['F1-P1', 'F1-P2', 'F1-P3']))).toMatchObject({ ok: false, code: 'over_capacity' });
    // Una persona de otra familia aunque se pase en la lista no cuenta como propia.
    const mixed = [...people, { id: 'F2-P1', invitationId: 'F2', name: 'Otra', active: true }];
    expect(decideRsvp(ctx({ people: mixed }), req(['F2-P1']))).toMatchObject({ ok: false, code: 'unknown_person' });
  });

  it('repetición, sin cambios y conflicto de revisión', () => {
    const first = decideRsvp(ctx(), req(['F1-P1']));
    if (!first.ok) throw new Error();
    const current = first.response;
    expect(decideRsvp(ctx({ current }), req(['F1-P1']))).toMatchObject({ ok: true, action: 'replay' });
    expect(decideRsvp(ctx({ current }), req(['F1-P1'], { requestId: 'otra-solicitud' }))).toMatchObject({ ok: true, action: 'unchanged' });
    const stale = decideRsvp(ctx({ current }), req(['F1-P2'], { requestId: 'otra-solicitud', expectedRevision: 0 }));
    expect(stale).toMatchObject({ ok: false, status: 409, code: 'conflict' });
    const fresh = decideRsvp(ctx({ current }), req(['F1-P2'], { requestId: 'otra-solicitud', expectedRevision: 1 }));
    expect(fresh).toMatchObject({ ok: true, action: 'write', response: { revision: 2, personIds: ['F1-P2'] } });
  });

  it('reutilizar un requestId con otra selección es un error, no un éxito', () => {
    const first = decideRsvp(ctx(), req(['F1-P1']));
    if (!first.ok) throw new Error();
    const current = first.response;
    expect(decideRsvp(ctx({ current }), req(['f1-p1']))).toMatchObject({ ok: true, action: 'replay' });
    expect(decideRsvp(ctx({ current }), req([]))).toMatchObject({ ok: false, status: 409, code: 'request_id_reused' });
    expect(decideRsvp(ctx({ current }), req(['F1-P1', 'F1-P2'], { expectedRevision: 1 }))).toMatchObject({ code: 'request_id_reused' });
  });

  it('borrar una respuesta no reinicia la revisión: un dispositivo atrasado recibe conflicto', () => {
    // La respuesta (revisión 1) se borró; la base queda en 2.
    expect(decideRsvp(ctx({ baseRevision: 2 }), req(['F1-P1'], { expectedRevision: 1 }))).toMatchObject({ code: 'conflict' });
    expect(decideRsvp(ctx({ baseRevision: 2 }), req(['F1-P1'], { expectedRevision: 2 }))).toMatchObject({ action: 'write', response: { revision: 3 } });
    expect(toGuestView({ group: 'F', seats: 4 }, people, null, true, 2).revision).toBe(2);
  });

  it('filas de la hoja: "activa" no reconocida cuenta como inactiva; "revocado" no es un token', () => {
    const p = parsePersonRow({ id: 'F1-P1', invitationId: 'F1', name: 'Ana', active: 'baja' });
    expect(p.value.active).toBe(false);
    expect(p.errors.join()).toMatch(/activa/);
    const inv = parseInvitationRow({ id: 'F1', group: 'Familia', seats: 2, active: 'sí', token: 'Revocado' });
    expect(inv.errors).toEqual([]);
    expect(inv.value).toMatchObject({ token: null, revoked: true, active: true });
    expect(parseInvitationRow({ id: 'F1', group: 'Familia', seats: 2, active: 'quizá' }).value.active).toBe(false);
  });

  it('un teléfono, lado o notas mal capturados se reportan pero no bloquean la invitación', () => {
    const row = parseInvitationRow({ id: 'INV-1', group: 'A', side: 'tía', phone: '123', seats: '2', active: 'sí', token: '' });
    expect(row.errors).toHaveLength(2);
    expect(row.blocking).toEqual([]);
    expect(invitationBlockers(row, { invitations: [row], people: [], responses: [] })).toEqual([]);
    const bad = parseInvitationRow({ id: 'INV-2', group: 'B', seats: 'dos', active: 'quizá', token: '' });
    expect(bad.blocking).toHaveLength(2);
    expect(invitationBlockers(bad, { invitations: [bad], people: [], responses: [] })).toHaveLength(1);
  });

  it('en la hoja, una invitación con ID repetido, personas compartidas o respuesta inválida no se atiende', () => {
    const inv = (id: string) => parseInvitationRow({ id, group: 'Familia', seats: 2, active: 'sí' });
    const person = (id: string, invitationId: string, active = 'sí') => parsePersonRow({ id, invitationId, name: 'Nombre', active });
    const resp = (invitationId: string, status: string) => parseResponseRow({ invitationId, personIds: '', status, revision: 1 });
    const base = { invitations: [inv('F1'), inv('F2')], people: [person('F1-P1', 'F1'), person('F2-P1', 'F2')], responses: [] };
    expect(invitationBlockers(base.invitations[0], base)).toEqual([]);
    expect(invitationBlockers(base.invitations[0], { ...base, invitations: [...base.invitations, inv('f1')] })).toHaveLength(1);
    expect(invitationBlockers(base.invitations[0], { ...base, people: [...base.people, person('F1-P1', 'F2')] })).toHaveLength(1);
    expect(invitationBlockers(base.invitations[0], { ...base, people: [person('F1-P1', 'F1', 'baja')] })).toHaveLength(1);
    expect(invitationBlockers(base.invitations[0], { ...base, responses: [resp('F1', 'sí')] })).toHaveLength(1);
    expect(invitationBlockers(base.invitations[0], { ...base, responses: [resp('F1', 'no asistirá'), resp('F1', 'no asistirá')] })).toHaveLength(1);
    expect(invitationBlockers(base.invitations[1], { ...base, responses: [resp('F1', 'sí')] })).toEqual([]);
  });

  it('respuesta escrita a mano con personas repetidas ("P1, P1" o "P1, p1"): error visible, no se atiende y no cuenta', () => {
    const inv = parseInvitationRow({ id: 'INV-9', group: 'Familia Nueve', seats: '2', active: 'sí', token: '' });
    const people = ['INV-9-P1', 'INV-9-P2'].map((id) => parsePersonRow({ id, invitationId: 'INV-9', name: id, active: 'sí' }));
    for (const ids of ['INV-9-P1, INV-9-P1', 'INV-9-P1, inv-9-p1']) {
      const resp = parseResponseRow({ invitationId: 'INV-9', personIds: ids, status: 'asistirá', revision: '1', updatedAt: 'x', requestId: 'a-mano-0001' });
      expect(resp.errors.join(' '), ids).toMatch(/La respuesta repite a la persona INV-9-P1/i);
      const rows = { invitations: [inv], people, responses: [resp] };
      expect(invitationBlockers(inv, rows).join(' ')).toMatch(/repite/);
      expect(rowIssues(rows).map((i) => `${i.tab} ${i.id}: ${i.message}`).join('\n')).toMatch(/Respuestas INV-9: La respuesta repite/);
      // Aunque la fila llegara a las reglas, la revisión la marca y los totales no la cuentan.
      const roster = checkRoster([inv.value], people.map((p) => p.value), [resp.value], { live: true });
      expect(roster.map((i) => `${i.severity} ${i.message}`).join('\n')).toMatch(/error La respuesta repite/);
      expect(summarize([inv.value], people.map((p) => p.value), [resp.value])).toMatchObject({ attending: 0, attendingPeople: 0, pending: 1 });
    }
    const ok = parseResponseRow({ invitationId: 'INV-9', personIds: 'INV-9-P1, INV-9-P2', status: 'asistirá', revision: '1', updatedAt: 'x', requestId: 'a-mano-0002' });
    expect(ok.errors).toEqual([]);
    expect(invitationBlockers(inv, { invitations: [inv], people, responses: [ok] })).toEqual([]);
    expect(summarize([inv.value], people.map((p) => p.value), [ok.value])).toMatchObject({ attending: 1, attendingPeople: 2, pending: 0 });
  });

  it('respuesta a mano con una persona de otra invitación o con más personas que cupo: se pide revisar y no cuenta', () => {
    const inv = parseInvitationRow({ id: 'INV-8', group: 'Familia Ocho', seats: '1', active: 'sí', token: '' });
    const people = [
      parsePersonRow({ id: 'INV-8-P1', invitationId: 'INV-8', name: 'Uno', active: 'sí' }),
      parsePersonRow({ id: 'INV-8-P2', invitationId: 'INV-8', name: 'Dos', active: 'sí' }),
      parsePersonRow({ id: 'INV-7-P1', invitationId: 'INV-7', name: 'Ajena', active: 'sí' }),
    ];
    for (const ids of ['INV-7-P1', 'INV-8-P1, INV-8-P2']) {
      const resp = parseResponseRow({ invitationId: 'INV-8', personIds: ids, status: 'asistirá', revision: '1', updatedAt: 'x', requestId: 'a-mano-0003' });
      expect(resp.errors).toEqual([]);
      expect(invitationBlockers(inv, { invitations: [inv], people, responses: [resp] }).join(' '), ids).toMatch(/no pertenece|cupo de 1/);
      expect(summarize([inv.value], people.map((p) => p.value), [resp.value])).toMatchObject({ attending: 0, pending: 1 });
    }
  });

  it('una invitación en revisión (p. ej. una respuesta válida y otra repetida) se reporta y no cuenta en los totales', () => {
    const inv = parseInvitationRow({ id: 'INV-9', group: 'Familia Nueve', seats: '2', active: 'sí', token: '' });
    const people = ['INV-9-P1', 'INV-9-P2'].map((id) => parsePersonRow({ id, invitationId: 'INV-9', name: id, active: 'sí' }));
    const row = (ids: string, revision: string) =>
      parseResponseRow({ invitationId: 'INV-9', personIds: ids, status: 'asistirá', revision, updatedAt: 'x', requestId: `a-mano-000${revision}` });
    for (const responses of [
      [row('INV-9-P1', '1'), row('INV-9-P1, INV-9-P1', '2')], // la segunda fila es inválida y se descarta de los totales
      [row('INV-9-P1', '1'), row('INV-9-P2', '2')], // dos filas válidas
    ]) {
      const rows = { invitations: [inv], people, responses };
      const review = invitationsInReview(rows);
      expect(review.map((r) => r.id)).toEqual(['INV-9']);
      expect(inReviewIssue(review[0]).message).toMatch(/^En revisión: .*Hay más de una respuesta para esta invitación/);
      const valid = responses.filter((r) => !r.errors.length).map((r) => r.value);
      // Sin la marca, los totales contarían la fila válida; con ella, queda pendiente.
      expect(summarize([inv.value], people.map((p) => p.value), valid).attending).toBe(1);
      expect(summarize([inv.value], people.map((p) => p.value), valid, ['inv-9'])).toMatchObject({ attending: 0, attendingPeople: 0, pending: 1, inReview: 1 });
    }
    // Una invitación sin problemas o inactiva no queda en revisión.
    expect(invitationsInReview({ invitations: [inv], people, responses: [row('INV-9-P1', '1')] })).toEqual([]);
    const inactive = parseInvitationRow({ id: 'INV-9', group: 'Familia Nueve', seats: '2', active: 'no', token: '' });
    expect(invitationsInReview({ invitations: [inactive], people, responses: [row('INV-9-P1, INV-9-P1', '1')] })).toEqual([]);
    const demo = parseInvitationRow({ id: 'DEMO-009', group: 'Demo', seats: '2', active: 'sí', token: '' });
    const demoResp = parseResponseRow({ invitationId: 'DEMO-009', personIds: 'DEMO-009-P1, DEMO-009-P1', status: 'asistirá', revision: '1', updatedAt: 'x', requestId: 'a-mano-0009' });
    expect(invitationsInReview({ invitations: [demo], people: [], responses: [demoResp] })).toEqual([]);
  });

  it('respeta el cierre, el cupo pendiente y la invitación inactiva', () => {
    expect(decideRsvp(ctx({ rsvpOpen: false }), req(['F1-P1']))).toMatchObject({ code: 'rsvp_closed' });
    expect(decideRsvp(ctx({ invitation: { id: 'F1', seats: null, active: true } }), req(['F1-P1']))).toMatchObject({ code: 'seats_unassigned' });
    expect(decideRsvp(ctx({ invitation: { id: 'F1', seats: 4, active: false } }), req(['F1-P1']))).toMatchObject({ code: 'not_found' });
  });

  it('la revisión de la lista avisa sin combinar y marca datos de demostración en la lista real', () => {
    const issues = checkRoster(
      [
        { id: 'INV-1', group: 'A', side: null, contact: null, phone: '523300000001', seats: 2, active: true, token: null, notes: null },
        { id: 'INV-2', group: 'B', side: null, contact: null, phone: '523300000001', seats: 1, active: true, token: 'demo_AAAAAAAAAAAAAAAAAAAAAAAA', notes: null },
        { id: 'DEMO-9', group: 'C', side: null, contact: null, phone: null, seats: 1, active: true, token: null, notes: null },
      ],
      [
        { id: 'P1', invitationId: 'INV-1', name: 'Uno', active: true },
        { id: 'P2', invitationId: 'INV-2', name: 'Dos', active: true },
        { id: 'P3', invitationId: 'INV-2', name: 'Tres', active: true },
        { id: 'P9', invitationId: 'NO-EXISTE', name: 'Nadie', active: true },
      ],
      [],
      { live: true },
    );
    const text = issues.map((i) => `${i.severity}:${i.id}:${i.message}`).join('\n');
    expect(text).toMatch(/warning:INV-2:Mismo teléfono que INV-1/);
    expect(text).toMatch(/error:INV-2:El token no es un enlace real/);
    expect(text).toMatch(/error:DEMO-9:Este ID es de demostración/);
    expect(text).toMatch(/error:P9:La invitación NO-EXISTE no existe/);
    expect(text).toMatch(/warning:INV-2:2 personas autorizadas y cupo de 1/);
    expect(text).toMatch(/warning:INV-1:Cupo de 2 y 1 persona autorizada: el cupo extra no se puede usar/);
  });

  it('los totales salen del registro vigente', () => {
    const s = summarize(
      [
        { id: 'A', group: 'A', side: null, contact: null, phone: null, seats: 4, active: true, token: null, notes: null },
        { id: 'B', group: 'B', side: null, contact: null, phone: null, seats: 2, active: true, token: null, notes: null },
        { id: 'C', group: 'C', side: null, contact: null, phone: null, seats: 3, active: false, token: null, notes: null },
      ],
      [
        { id: 'A1', invitationId: 'A', name: 'a1', active: true },
        { id: 'A2', invitationId: 'A', name: 'a2', active: true },
        { id: 'B1', invitationId: 'B', name: 'b1', active: true },
      ],
      [{ invitationId: 'A', personIds: ['A1', 'A2'], status: 'attending', revision: 1, updatedAt: '', requestId: 'r' }],
    );
    expect(s).toMatchObject({ invitations: 2, seatsAssigned: 6, people: 3, attendingPeople: 2, attending: 1, pending: 1, unusedSeats: 2 });
  });
});
