import type { AdminInvitation, AdminSummary, BackendStatus, CommStatus, ImportPreview } from '../../shared/types';
import { request } from '../lib/api';

export type AdminRow = AdminInvitation & { link: string | null };
export interface MessageView {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  seats: number | null;
  link: string;
  text: string;
  waUrl: string;
  comm: { status: CommStatus; source: string | null; at: string | null };
  note?: string;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

export const adminApi = {
  session: () => request<{ authenticated: boolean; configured: boolean }>('/api/admin/session'),
  login: (password: string) => request<{ authenticated: boolean }>('/api/admin/login', json('POST', { password })),
  logout: () => request<{ authenticated: boolean }>('/api/admin/logout', json('POST', {})),
  backend: () => request<BackendStatus>('/api/admin/backend'),
  summary: () => request<AdminSummary>('/api/admin/summary'),
  list: (p: { q: string; status: string }) => request<AdminRow[]>(`/api/admin/invitations?${new URLSearchParams(p).toString()}`),
  create: (body: unknown) => request<AdminRow>('/api/admin/invitations', json('POST', body)),
  update: (id: number, body: unknown) => request<AdminRow>(`/api/admin/invitations/${id}`, json('PUT', body)),
  remove: (id: number) => request<{ deleted: boolean }>(`/api/admin/invitations/${id}`, json('DELETE')),
  regenerate: (id: number) => request<AdminRow>(`/api/admin/invitations/${id}/regenerate-link`, json('POST', {})),
  revoke: (id: number) => request<AdminRow>(`/api/admin/invitations/${id}/revoke-link`, json('POST', {})),
  setResponse: (id: number, body: { status: 'attending' | 'declined'; personIds: string[] }) =>
    request<AdminRow>(`/api/admin/invitations/${id}/response`, json('PUT', body)),
  clearResponse: (id: number) => request<AdminRow>(`/api/admin/invitations/${id}/response`, json('DELETE')),
  setRsvpOpen: (rsvpOpen: boolean) => request<AdminSummary>('/api/admin/settings', json('PUT', { rsvpOpen })),
  previewImport: (files: { invitations?: string; people?: string }) => request<ImportPreview>('/api/admin/import/preview', json('POST', files)),
  applyImport: (files: { invitations?: string; people?: string }) => request<ImportPreview>('/api/admin/import/apply', json('POST', files)),
  messaging: () => request<{ provider: { id: string; label: string; sendsRealMessages: boolean } }>('/api/admin/messaging'),
  message: (id: number) => request<MessageView>(`/api/admin/invitations/${id}/message`),
  prepare: (id: number) => request<MessageView>(`/api/admin/invitations/${id}/message/prepare`, json('POST', {})),
  manual: (id: number, status: 'sent' | 'delivered') =>
    request<MessageView>(`/api/admin/invitations/${id}/message/manual`, json('POST', { status })),
};

export { copyText } from '../lib/clipboard';
