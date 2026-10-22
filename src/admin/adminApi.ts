import type { AdminInvitation, AdminSummary, CommStatus, ImportPreview } from '../../shared/types';
import { request } from '../lib/api';

export type AdminRow = AdminInvitation & { link: string };
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
  summary: (demo: string) => request<AdminSummary>(`/api/admin/summary?demo=${demo}`),
  list: (p: { q: string; status: string; demo: string }) =>
    request<AdminRow[]>(`/api/admin/invitations?${new URLSearchParams(p).toString()}`),
  create: (body: unknown) => request<AdminRow>('/api/admin/invitations', json('POST', body)),
  update: (id: number, body: unknown) => request<AdminRow>(`/api/admin/invitations/${id}`, json('PUT', body)),
  remove: (id: number) => request<{ deleted: boolean }>(`/api/admin/invitations/${id}`, json('DELETE')),
  regenerate: (id: number) => request<AdminRow>(`/api/admin/invitations/${id}/regenerate-link`, json('POST', {})),
  setResponse: (id: number, body: { status: 'attending' | 'declined'; adults: number }) =>
    request<AdminRow>(`/api/admin/invitations/${id}/response`, json('PUT', body)),
  clearResponse: (id: number) => request<AdminRow>(`/api/admin/invitations/${id}/response`, json('DELETE')),
  setRsvpOpen: (rsvpOpen: boolean) => request<AdminSummary>('/api/admin/settings', json('PUT', { rsvpOpen })),
  previewImport: (csv: string) => request<ImportPreview>('/api/admin/import/preview', json('POST', { csv })),
  applyImport: (csv: string) => request<ImportPreview>('/api/admin/import/apply', json('POST', { csv })),
  messaging: () => request<{ provider: { id: string; label: string; sendsRealMessages: boolean } }>('/api/admin/messaging'),
  message: (id: number) => request<MessageView>(`/api/admin/invitations/${id}/message`),
  prepare: (id: number) => request<MessageView>(`/api/admin/invitations/${id}/message/prepare`, json('POST', {})),
  manual: (id: number, status: 'sent' | 'delivered') =>
    request<MessageView>(`/api/admin/invitations/${id}/message/manual`, json('POST', { status })),
};

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
