import type { PatientRosterRow, PatientDetail, Patient, StoolEntry, PatientDocument, Analysis, DocKind, ExtractedDoc } from '../../shared/types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = { error: text.slice(0, 300) } }
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const api = {
  health: () => req<{ ok: boolean; db: boolean; timescaledb: string | null; dbError: string | null; openai: boolean; model: string }>('/api/health'),
  patients: () => req<PatientRosterRow[]>('/api/patients'),
  createPatient: (p: Partial<Patient>) => req<Patient>('/api/patients', { method: 'POST', body: JSON.stringify(p) }),
  patient: (id: string) => req<PatientDetail>(`/api/patients/${encodeURIComponent(id)}`),
  deletePatient: (id: string) => req<{ ok: true }>(`/api/patients/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  addEntries: (id: string, entries: Partial<StoolEntry>[]) => req<{ inserted: string[] }>(`/api/patients/${encodeURIComponent(id)}/entries`, { method: 'POST', body: JSON.stringify({ entries }) }),
  deleteEntry: (id: string, entryId: string) => req<{ ok: true }>(`/api/patients/${encodeURIComponent(id)}/entries/${entryId}`, { method: 'DELETE' }),
  updateEntry: (id: string, entryId: string, patch: Partial<StoolEntry>) => req<StoolEntry>(`/api/patients/${encodeURIComponent(id)}/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addDocument: (id: string, doc: { kind: DocKind; filename?: string; mime?: string; text?: string; image_data_url?: string; extracted?: ExtractedDoc }) =>
    req<PatientDocument & { model: string | null }>(`/api/patients/${encodeURIComponent(id)}/documents`, { method: 'POST', body: JSON.stringify(doc) }),
  deleteDocument: (id: string, docId: string) => req<{ ok: true }>(`/api/patients/${encodeURIComponent(id)}/documents/${docId}`, { method: 'DELETE' }),
  analyze: (id: string) => req<Analysis>(`/api/patients/${encodeURIComponent(id)}/analyze`, { method: 'POST' }),
  seed: (token?: string) => req<{ ok: true; patients: number; entries: number }>('/api/admin/seed', { method: 'POST', headers: token ? { 'x-seed-token': token } : {} }),
}
