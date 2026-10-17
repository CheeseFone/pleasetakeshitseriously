import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { PatientRosterRow, PatientStatus } from '../../shared/types'
import { api } from '../lib/api'
import { ago, age, STATUS_LABEL } from '../lib/format'
import { StatusPill, Sparkline, Spinner, ErrorBox, Card, SourcePill } from '../components/ui'
import { Camera, FileText, Cog, Close, ArrowRight } from '../components/icons'

const ORDER: Record<PatientStatus, number> = { urgent: 0, high: 1, watch: 2, nodata: 3, stable: 4 }

export default function Dashboard() {
  const [rows, setRows] = useState<PatientRosterRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const [showHow, setShowHow] = useState(() => { try { return localStorage.getItem('tss-how-dismissed') !== '1' } catch { return true } })
  useEffect(() => { if (params.get('how')) { setShowHow(true); try { localStorage.removeItem('tss-how-dismissed') } catch {} ; setParams({}, { replace: true }) } }, [params, setParams])
  const dismissHow = () => { setShowHow(false); try { localStorage.setItem('tss-how-dismissed', '1') } catch {} }

  const load = () => { setError(null); api.patients().then(setRows).catch(e => setError(e.message)) }
  useEffect(load, [])

  const counts = (rows ?? []).reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a }, {} as Record<string, number>)
  const sorted = [...(rows ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.room ?? '').localeCompare(b.room ?? ''))
  const attention = sorted.filter(r => r.status === 'urgent' || r.status === 'high')

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Residents</h1>
        <span className="text-sm text-muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={load} disabled={!rows}>Refresh</button>
          <button className="btn-primary" onClick={() => setAdding(v => !v)}>+ Resident</button>
        </div>
      </div>

      {showHow && <HowItWorks onDismiss={dismissHow} />}

      {attention.length > 0 && (
        <Card title="Needs attention today" right={<SourcePill kind="rules" />}>
          <ul className="divide-y divide-line -m-4">
            {attention.map(r => (
              <li key={r.id} className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-navy-50/60" onClick={() => nav(`/patients/${r.id}`)}>
                <StatusPill status={r.status} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.name} <span className="text-muted font-normal text-sm">· {r.room}</span></div>
                  <div className="text-sm text-ink/80">{r.top_finding}{r.top_expected === false && <span className="pill bg-urgent-bg text-urgent ml-2">Unexplained</span>}{r.top_expected === true && <span className="pill bg-navy-50 text-navy-800 ml-2">Explained by record</span>}</div>
                </div>
                <span className="text-navy-700 text-sm whitespace-nowrap inline-flex items-center gap-1">Open <ArrowRight size={14} /></span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {(['urgent', 'high', 'watch', 'stable', 'nodata'] as PatientStatus[]).map(s => (
          <div key={s} className="card px-3 py-2 flex items-center justify-between">
            <StatusPill status={s} />
            <span className="text-2xl font-semibold tabular-nums">{counts[s] ?? 0}</span>
          </div>
        ))}
      </div>

      {adding && <AddResident onDone={id => { setAdding(false); load(); if (id) nav(`/patients/${id}`) }} />}
      {error && <ErrorBox error={error} onRetry={load} />}

      <Card title="Residents" right={<span className="text-xs text-muted">{rows ? `${rows.length} on unit` : ''}</span>} className="overflow-hidden">
        {!rows && !error ? <div className="py-8 text-center"><Spinner /></div> : (
          <div className="-m-4 overflow-x-auto">
            <table className="table min-w-[680px]">
              <thead><tr><th>Status</th><th>Resident</th><th>Room</th><th>Last BM</th><th>Last 14 days</th><th>What's going on</th><th></th></tr></thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.id} className="hover:bg-navy-50/60 cursor-pointer" onClick={() => nav(`/patients/${r.id}`)}>
                    <td><StatusPill status={r.status} /></td>
                    <td><div className="font-medium">{r.name}</div><div className="text-xs text-muted">{age(r.dob) != null ? `${age(r.dob)} y` : ''}{r.sex ? ` · ${r.sex}` : ''}</div></td>
                    <td className="tabular-nums">{r.room ?? '—'}</td>
                    <td className="whitespace-nowrap"><div>{ago(r.last_bm)}</div><div className="text-xs text-muted">{r.entry_count_7d} this week</div></td>
                    <td><Sparkline types={r.recent_types} /></td>
                    <td className="text-sm max-w-[340px]">{r.top_finding ? <>{r.top_finding}{r.top_expected === false && <span className="pill bg-urgent-bg text-urgent ml-2">Unexplained</span>}</> : <span className="text-muted">{STATUS_LABEL[r.status] === 'No data' ? 'No entries yet' : 'Within normal range'}</span>}</td>
                    <td className="text-right whitespace-nowrap">
                      <Link to={`/patients/${r.id}/capture`} onClick={e => e.stopPropagation()} className="btn-accent !min-h-8 !py-1 !px-2.5 text-xs"><Camera size={14} /> Log</Link>
                    </td>
                  </tr>
                ))}
                {rows && !rows.length && <tr><td colSpan={7} className="text-center text-muted py-8">No residents yet. Add one, or load the demo data from Settings.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function HowItWorks({ onDismiss }: { onDismiss: () => void }) {
  const steps = [
    { Icon: Camera, title: 'Photo, scored on the device', body: 'A CNA snaps the stool. Two small models in the browser give the Bristol type. The photo never leaves the iPad; only the score is saved.' },
    { Icon: FileText, title: 'Records, structured by AI', body: 'Chart, MAR and menu are dropped in. The AI pulls out medications, diagnoses, diet and recent changes.' },
    { Icon: Cog, title: 'Cross-check, with the why', body: 'Rules compare the bowel trend with the record: expected (antibiotic, low fibre) or unexplained. The AI then suggests where to look.' },
  ]
  return (
    <div className="card p-4 relative">
      <button onClick={onDismiss} className="absolute right-2 top-2 text-muted hover:text-ink min-h-[32px] min-w-[32px] inline-flex items-center justify-center" aria-label="Dismiss"><Close size={16} /></button>
      <div className="label mb-3">How it works</div>
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((st, i) => (
          <li key={i} className="flex gap-3">
            <div className="shrink-0 h-10 w-10 rounded-full bg-navy-50 text-navy-700 flex items-center justify-center"><st.Icon size={20} /></div>
            <div><div className="font-semibold text-sm"><span className="text-navy-600 mr-1">{i + 1}.</span>{st.title}</div><p className="text-sm text-muted mt-0.5">{st.body}</p></div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function AddResident({ onDone }: { onDone: (id?: string) => void }) {
  const [f, setF] = useState({ name: '', room: '', dob: '', sex: '', summary: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { const p = await api.createPatient({ ...f, dob: f.dob || null }); onDone(p.id) } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <Card title="New resident">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-5 items-end">
        <label className="sm:col-span-2"><span className="label">Full name</span><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label><span className="label">Room</span><input className="input" value={f.room} onChange={e => setF({ ...f, room: e.target.value })} /></label>
        <label><span className="label">Date of birth</span><input className="input" type="date" value={f.dob} onChange={e => setF({ ...f, dob: e.target.value })} /></label>
        <label><span className="label">Sex</span><select className="input" value={f.sex} onChange={e => setF({ ...f, sex: e.target.value })}><option value="">—</option><option>F</option><option>M</option><option>Other</option></select></label>
        <label className="sm:col-span-4"><span className="label">One-line summary</span><input className="input" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} placeholder="e.g. 84 y, HTN, knee OA, low-fibre preferences" /></label>
        <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : 'Add'}</button><button type="button" className="btn-ghost" onClick={() => onDone()}>Cancel</button></div>
        {err && <div className="sm:col-span-5"><ErrorBox error={err} /></div>}
      </form>
    </Card>
  )
}
