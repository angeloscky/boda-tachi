export type AttendanceStatus = 'pending' | 'attending' | 'declined';
export type CommStatus = 'none' | 'prepared' | 'sent' | 'delivered' | 'failed';

/** Lo que ve un invitado al abrir su enlace. Solo datos de su propia invitación. */
export interface PublicInvitation {
  name: string;
  seats: number | null;
  canRespond: boolean;
  closedReason: 'seats_unassigned' | 'rsvp_closed' | 'invitation_disabled' | null;
  response: { status: 'attending' | 'declined'; adults: number; updatedAt: string } | null;
}

export interface RsvpInput {
  status: 'attending' | 'declined';
  adults: number;
}

export interface AdminInvitation {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  seats: number | null;
  token: string;
  enabled: boolean;
  isDemo: boolean;
  notes: string | null;
  attendance: AttendanceStatus;
  adults: number;
  respondedAt: string | null;
  comm: { status: CommStatus; source: string | null; at: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface AdminSummary {
  invitations: number;
  incomplete: number;
  seatsAssigned: number;
  attending: number;
  declined: number;
  pending: number;
  adultsConfirmed: number;
  rsvpOpen: boolean;
}

export interface ImportRowResult {
  line: number;
  code: string;
  name: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  errors: string[];
  warnings: string[];
}

export interface ImportPreview {
  rows: ImportRowResult[];
  canApply: boolean;
  counts: { create: number; update: number; unchanged: number; error: number };
}

export interface ApiError {
  error: string;
  message: string;
}
