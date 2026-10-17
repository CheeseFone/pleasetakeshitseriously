import type { PatientStatus, Severity, BristolGroup } from '../../shared/types'

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const h = (Date.now() - +new Date(iso)) / 3_600_000
  if (h < 1) return 'just now'
  if (h < 24) return `${Math.floor(h)} h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
export const age = (dob: string | null) => (dob ? Math.floor((Date.now() - +new Date(dob)) / (365.25 * 86_400_000)) : null)

export const STATUS_LABEL: Record<PatientStatus, string> = { urgent: 'Urgent', high: 'High', watch: 'Watch', stable: 'Stable', nodata: 'No data' }
export const statusClass = (s: PatientStatus | Severity): string => ({
  urgent: 'bg-urgent-bg text-urgent', high: 'bg-high-bg text-high', watch: 'bg-watch-bg text-watch',
  stable: 'bg-stable-bg text-stable', info: 'bg-stable-bg text-stable', nodata: 'bg-nodata-bg text-nodata',
})[s]

export const BRISTOL_DESC: Record<number, string> = {
  1: 'Separate hard lumps', 2: 'Lumpy, sausage-shaped', 3: 'Sausage with cracks', 4: 'Smooth, soft sausage',
  5: 'Soft blobs, clear edges', 6: 'Mushy, ragged edges', 7: 'Watery, no solid pieces',
}
export const groupClass = (g: BristolGroup | null): string => g === 0 ? 'bg-amber-100 text-b-hard' : g === 2 ? 'bg-orange-100 text-b-loose' : g === 1 ? 'bg-green-100 text-b-normal' : 'bg-nodata-bg text-nodata'
export const groupColor = (g: BristolGroup | null): string => g === 0 ? '#92400e' : g === 2 ? '#c2410c' : g === 1 ? '#15803d' : '#94a3b8'
export const typeColor = (t: number | null): string => t == null ? '#94a3b8' : groupColor(t <= 2 ? 0 : t <= 5 ? 1 : 2)
