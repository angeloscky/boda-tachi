import { describe, expect, it } from 'vitest';
import {
  checkRoster,
  decideRsvp,
  parseRsvpRequest,
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
