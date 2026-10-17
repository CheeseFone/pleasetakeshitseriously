import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useLocation } from 'react-router-dom'
import { ScatterChart, Scatter, XAxis, YAxis, ReferenceArea, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { PatientDetail, StoolEntry, PatientDocument, DocKind, Analysis, ExtractedDoc } from '../../shared/types'
import { DOC_KIND_LABEL, FLAG_LABEL, GROUP_LABEL } from '../../shared/types'
import { api } from '../lib/api'
import { thumbs } from '../lib/idb'
import { pdfToText, imageToDataUrl } from '../lib/pdf'
import { age, fmtDateTime, fmtDate, ago, typeColor, BRISTOL_DESC } from '../lib/format'
import { Card, FindingCard, StatusPill, BristolBadge, Spinner, ErrorBox, Empty, Collapsible, SourcePill } from '../components/ui'
import { Camera, Stethoscope, Check, Close, FileText as FileTextIcon } from '../components/icons'

type Tab = 'overview' | 'log' | 'records'

export default function PatientPage() {
  const { id = '' } = useParams()
  const [d, setD] = useState<PatientDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const loc = useLocation()
  const arrived = (loc.state ?? null) as { added: number; prevStatus: PatientDetail['status'] | null; prevTop: string | null } | null
  const [banner, setBanner] = useState(!!arrived)
  const load = useCallback(() => api.patient(id).then(setD).catch(e => setErr(e.message)), [id])
  useEffect(() => { load() }, [load])

  if (err) return <ErrorBox error={err} onRetry={load} />
  if (!d) return <div className="py-10 text-center"><Spinner /></div>
  const p = d.patient
  const last = d.entries[d.entries.length - 1]
  const now = Date.now()
  const week = d.entries.filter(e => now - +new Date(e.time) < 7 * 86_400_000)
  const typed = d.entries.filter(e => e.bristol_type != null && now - +new Date(e.time) < 14 * 86_400_000).map(e => e.bristol_type as number).sort((a, b) => a - b)
  const usual = typed.length ? typed[Math.floor(typed.length / 2)] : null
  const meds = new Set(d.documents.flatMap(x => x.extracted?.medications.map(m => m.name.toLowerCase()) ?? [])).size
  const tabs: { k: Tab; label: string }[] = [
    { k: 'overview', label: 'Overview' },
    { k: 'log', label: `Bowel log · ${d.entries.length}` },
    { k: 'records', label: `Records · ${d.documents.length}` },
  ]

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <Link to="/" className="text-sm text-navy-700 hover:underline inline-block">← All residents</Link>
      <div className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-semibold leading-tight">{p.name}</h1>
              <StatusPill status={d.status} />
            </div>
            <div className="text-sm text-muted mt-0.5">{[p.room && `Room ${p.room}`, age(p.dob) != null && `${age(p.dob)} y`, p.sex].filter(Boolean).join(' · ')}{last && <> · last BM <span className="text-ink">{ago(last.time)}</span></>}</div>
            {p.summary && <p className="text-sm mt-2 text-ink/80">{p.summary}</p>}
          </div>
          <Link to={`/patients/${id}/capture`} className="btn-accent w-full sm:w-auto"><Camera size={18} /> Log stool</Link>
        </div>
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {[
            ['Last BM', last ? ago(last.time) : '—', last?.bristol_type ? `type ${last.bristol_type}` : ''],
            ['This week', `${week.length} ${week.length === 1 ? 'stool' : 'stools'}`, week.filter(e => e.flags.length).length ? `${week.filter(e => e.flags.length).length} with flags` : 'no flags'],
            ['Usual type (14 d)', usual != null ? `Type ${usual}` : '—', usual != null ? BRISTOL_DESC[usual] : ''],
            ['Records', `${d.documents.length} on file`, meds ? `${meds} medication${meds === 1 ? '' : 's'}` : 'no MAR yet'],
          ].map(([k, v, sub]) => (
            <div key={k} className="rounded border border-line bg-navy-50/50 px-3 py-2"><dt className="label">{k}</dt><dd className="font-semibold mt-0.5">{v}</dd>{sub && <dd className="text-xs text-muted">{sub}</dd>}</div>
          ))}
        </dl>
      </div>

      <div className="flex rounded-md border border-line bg-white p-1 text-sm font-medium">
        {tabs.map(t => <button key={t.k} onClick={() => setTab(t.k)} className={`flex-1 rounded px-3 py-2 min-h-[40px] ${tab === t.k ? 'bg-navy-700 text-white' : 'text-navy-800 hover:bg-navy-50'}`}>{t.label}</button>)}
      </div>

      {banner && arrived && (
        <div className="rounded-md border border-teal-500/40 bg-teal-100 px-4 py-3 text-sm flex items-start gap-3">
          <span className="text-teal-600 mt-0.5"><Check size={18} /></span>
          <div className="flex-1">
            <div className="font-semibold">{arrived.added} photo{arrived.added === 1 ? '' : 's'} logged. Scored on this device, nothing uploaded.</div>
            <div className="mt-0.5 flex items-center gap-2 flex-wrap">
              <span>Risk rules re-run:</span>
              {arrived.prevStatus && arrived.prevStatus !== d.status ? <><StatusPill status={arrived.prevStatus} /><span>→</span><StatusPill status={d.status} /></> : <StatusPill status={d.status} />}
            </div>
            {(() => { const top = d.findings[0] && d.findings[0].severity !== 'info' ? d.findings[0].title : null
              if (top && top !== arrived.prevTop) return <div className="mt-0.5"><span className="text-muted">Was:</span> {arrived.prevTop ?? 'no concerns'} <span className="mx-1">→</span> <span className="font-medium">Now: {top}</span></div>
              return top ? <div className="mt-0.5 text-muted">Top finding unchanged: {top}</div> : null })()}
          </div>
          <button className="text-muted hover:text-ink" onClick={() => setBanner(false)} aria-label="Dismiss"><Close size={16} /></button>
        </div>
      )}
      {tab === 'overview' && (
        <div className="space-y-4">
          <section className="space-y-2">
            {d.findings.length ? d.findings.map((f, i) => <FindingCard key={f.id} f={f} defaultOpen={i === 0 && f.severity !== 'info'} />) : <Empty>No entries yet — log a stool to start tracking.</Empty>}
          </section>
          <AnalysisPanel id={id} analysis={d.analysis} onDone={load} hasDocs={d.documents.length > 0} />
          <Card title="Bowel trend · 30 days">
            <TrendChart entries={d.entries} />
          </Card>
        </div>
      )}
      {tab === 'log' && <EntriesTable id={id} entries={d.entries} onChange={load} />}
      {tab === 'records' && (
        <div className="grid gap-4 lg:grid-cols-2 items-start">
          <DropBox id={id} docs={d.documents} onChange={load} />
          <RecordSummary docs={d.documents} />
        </div>
      )}
    </div>
  )
}

/* ---------------- AI analysis ---------------- */
const URG_LABEL = { now: 'Now', today: 'Today', this_week: 'This week', routine: 'Routine' } as const
const URG_CLASS = { now: 'bg-urgent-bg text-urgent', today: 'bg-high-bg text-high', this_week: 'bg-watch-bg text-watch', routine: 'bg-nodata-bg text-nodata' } as const
const URG_ORDER = { now: 0, today: 1, this_week: 2, routine: 3 } as const
const RISK_BAND = { urgent: 'bg-urgent-bg border-urgent/30', high: 'bg-high-bg border-high/30', moderate: 'bg-watch-bg border-watch/30', low: 'bg-stable-bg border-stable/30' } as const
const RISK_PILL = { urgent: 'urgent', high: 'high', moderate: 'watch', low: 'stable' } as const
const RISK_TEXT = { urgent: 'Urgent', high: 'High risk', moderate: 'Moderate risk', low: 'Low risk' } as const
const Likelihood = ({ v }: { v: 'high' | 'moderate' | 'low' }) => {
  const n = { high: 3, moderate: 2, low: 1 }[v]
  return <span className="inline-flex items-center gap-0.5 ml-2 align-middle" title={`${v} likelihood`}>{[1, 2, 3].map(i => <span key={i} className={`h-2 w-2 rounded-full ${i <= n ? 'bg-navy-600' : 'bg-line'}`} />)}<span className="text-[11px] text-muted ml-1 capitalize">{v}</span></span>
}

function AnalysisPanel({ id, analysis, onDone, hasDocs }: { id: string; analysis: Analysis | null; onDone: () => void; hasDocs: boolean }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const run = async () => { setBusy(true); setErr(null); try { await api.analyze(id); onDone() } catch (e: any) { setErr(e.message) } finally { setBusy(false) } }
  const r = analysis?.result
  const actions = r ? [...r.recommended_actions].sort((a, b) => URG_ORDER[a.urgency] - URG_ORDER[b.urgency]) : []
  return (
    <Card title={<span className="flex items-center gap-2">AI second opinion <SourcePill kind="ai" /></span>} right={
      <button className="btn-primary !min-h-8 !py-1 text-xs" disabled={busy} onClick={run}>{busy ? <><Spinner /> Analysing…</> : analysis ? 'Re-analyse' : 'Analyse record'}</button>}>
      {err && <ErrorBox error={err} />}
      {!r && !err && (
        <div className="text-sm text-muted flex gap-3 items-start">
          <span className="text-navy-700 mt-0.5"><Stethoscope size={22} /></span>
          <p>Reads the bowel log together with the chart, MAR and diet record, says whether the pattern is expected, and suggests where to look.{!hasDocs && ' Add the chart and MAR under Records first for a useful answer.'}</p>
        </div>
      )}
      {r && (
        <div className="space-y-4">
          <div className={`rounded-md border px-4 py-3 ${RISK_BAND[r.risk_level]}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={RISK_PILL[r.risk_level]} />
              <span className="text-xs font-semibold uppercase tracking-wide text-ink/60">{RISK_TEXT[r.risk_level]}</span>
            </div>
            <h3 className="font-semibold text-lg leading-snug mt-1">{r.headline}</h3>
            <p className="text-sm mt-1.5 text-ink/80">{r.summary}</p>
          </div>

          {actions.length > 0 && (
            <div>
              <div className="label mb-2">Do next</div>
              <ol className="space-y-2">{actions.slice(0, 3).map((a, i) => (
                <li key={i} className="flex gap-3 items-start rounded-md border border-line bg-white px-3 py-2.5">
                  <span className="shrink-0 h-6 w-6 rounded-full bg-navy-700 text-white text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-medium">{a.action}</div>
                    <div className="text-xs text-muted mt-0.5">{a.rationale}</div>
                  </div>
                  <span className={`pill shrink-0 ${URG_CLASS[a.urgency]}`}>{URG_LABEL[a.urgency]}</span>
                </li>
              ))}</ol>
            </div>
          )}

          <Collapsible label="See the reasoning" openLabel="Hide the reasoning">
            <div className="space-y-5 pt-2">
              {r.likely_causes.length > 0 && (
                <section>
                  <div className="label mb-2">Likely causes, most likely first</div>
                  <ol className="divide-y divide-line rounded-md border border-line bg-white">
                    {[...r.likely_causes].sort((a, b) => URG_ORDER_L[a.likelihood] - URG_ORDER_L[b.likelihood]).map((c, i) => (
                      <li key={i} className="px-3 py-2.5 text-sm">
                        <div className="font-medium">{c.cause}<Likelihood v={c.likelihood} /></div>
                        <div className="text-xs text-muted mt-0.5">{c.evidence}</div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {r.observations.length > 0 && (
                <section>
                  <div className="label mb-2">What the record explains, and what it doesn't</div>
                  <ul className="divide-y divide-line rounded-md border border-line bg-white">
                    {[...r.observations].sort((a, b) => Number(a.expected) - Number(b.expected)).map((o, i) => (
                      <li key={i} className="px-3 py-2.5 text-sm flex gap-3 items-start">
                        <span className={`pill shrink-0 mt-0.5 ${o.expected ? 'bg-stable-bg text-stable' : 'bg-urgent-bg text-urgent'}`}>{o.expected ? 'Expected' : 'Unexpected'}</span>
                        <div className="min-w-0"><div className="font-medium">{o.observation}</div><div className="text-xs text-muted mt-0.5">{o.reason}</div></div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {actions.length > 3 && (
                <section>
                  <div className="label mb-2">Also worth doing</div>
                  <ul className="space-y-1.5">{actions.slice(3).map((a, i) => (
                    <li key={i} className="text-sm flex gap-2 items-start"><span className={`pill shrink-0 mt-0.5 ${URG_CLASS[a.urgency]}`}>{URG_LABEL[a.urgency]}</span><span>{a.action}</span></li>
                  ))}</ul>
                </section>
              )}
              <div className="grid gap-5 md:grid-cols-2">
                {r.questions_for_team.length > 0 && (
                  <section>
                    <div className="label mb-2">Questions to ask the team</div>
                    <ul className="space-y-1.5 text-sm">{r.questions_for_team.map((q, i) => <li key={i} className="flex gap-2"><span className="text-navy-600">?</span><span>{q}</span></li>)}</ul>
                  </section>
                )}
                {r.data_gaps.length > 0 && (
                  <section>
                    <div className="label mb-2">Missing from the record</div>
                    <ul className="space-y-1.5 text-sm text-muted">{r.data_gaps.map((q, i) => <li key={i} className="flex gap-2"><span>–</span><span>{q}</span></li>)}</ul>
                  </section>
                )}
              </div>
            </div>
          </Collapsible>
          <p className="text-[11px] text-muted">Generated {ago(analysis!.created_at)} by {analysis!.model}. Based only on the records in this app. Verify before acting.</p>
        </div>
      )}
    </Card>
  )
}
const URG_ORDER_L = { high: 0, moderate: 1, low: 2 } as const

/* ---------------- Trend chart ---------------- */
function TrendChart({ entries }: { entries: StoolEntry[] }) {
  const now = Date.now()
  const data = useMemo(() => entries.filter(e => e.bristol_type != null && now - +new Date(e.time) < 30 * 86_400_000).map(e => ({ t: +new Date(e.time), type: e.bristol_type!, flags: e.flags, id: e.id })), [entries, now])
  if (!data.length) return <Empty>No entries in the last 30 days.</Empty>
  const min = now - 30 * 86_400_000
  return (
    <div className="h-60 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#e9edf2" />
          <ReferenceArea y1={0.5} y2={2.5} fill="#fde68a" fillOpacity={0.25} label={{ value: 'Constipated (1–2)', position: 'insideTopLeft', fontSize: 11, fill: '#92400e' }} />
          <ReferenceArea y1={2.5} y2={5.5} fill="#86efac" fillOpacity={0.2} label={{ value: 'Normal (3–5)', position: 'insideTopLeft', fontSize: 11, fill: '#15803d' }} />
          <ReferenceArea y1={5.5} y2={7.5} fill="#fdba74" fillOpacity={0.3} label={{ value: 'Loose (6–7)', position: 'insideTopLeft', fontSize: 11, fill: '#c2410c' }} />
          <XAxis type="number" dataKey="t" domain={[min, now]} tickFormatter={v => fmtDate(new Date(v).toISOString())} tick={{ fontSize: 11 }} tickCount={7} />
          <YAxis type="number" dataKey="type" domain={[0.5, 7.5]} ticks={[1, 2, 3, 4, 5, 6, 7]} tick={{ fontSize: 11 }} width={28} />
          <Tooltip cursor={false} content={({ payload }) => {
            const p = payload?.[0]?.payload; if (!p) return null
            return <div className="card px-2 py-1 text-xs"><div>{fmtDateTime(new Date(p.t).toISOString())}</div><div className="font-medium">Type {p.type} — {BRISTOL_DESC[p.type]}</div>{p.flags.length > 0 && <div className="text-muted">{p.flags.map((f: string) => FLAG_LABEL[f as keyof typeof FLAG_LABEL]).join(', ')}</div>}</div>
          }} />
          <Scatter data={data} shape={(props: any) => <circle cx={props.cx} cy={props.cy} r={props.payload.flags.length ? 7 : 5} fill={typeColor(props.payload.type)} stroke={props.payload.flags.length ? '#b91c1c' : '#fff'} strokeWidth={props.payload.flags.length ? 2 : 1} />} />
        </ScatterChart>
      </ResponsiveContainer>
      <div className="text-[11px] text-muted px-2 -mt-1">Each dot is one stool, by Bristol type. A red ring means the CNA flagged something (blood, straining, missed meal…).</div>
    </div>
  )
}

/* ---------------- Entries ---------------- */
function EntriesTable({ id, entries, onChange }: { id: string; entries: StoolEntry[]; onChange: () => void }) {
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({})
  const [showAll, setShowAll] = useState(false)
  const rows = useMemo(() => [...entries].sort((a, b) => +new Date(b.time) - +new Date(a.time)), [entries])
  const visible = showAll ? rows : rows.slice(0, 10)
  useEffect(() => {
    let alive = true
    ;(async () => { const m: Record<string, string> = {}; for (const e of visible) { const t = await thumbs.get(e.id); if (t) m[e.id] = t }; if (alive) setThumbMap(m) })()
    return () => { alive = false }
  }, [visible])
  const del = async (e: StoolEntry) => { if (!confirm('Delete this entry?')) return; await api.deleteEntry(id, e.id); await thumbs.del(e.id); onChange() }
  return (
    <Card title="Bowel log" right={rows.length > 10 && <button className="text-xs text-navy-700 hover:underline" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show recent' : `Show all ${rows.length}`}</button>} className="overflow-hidden">
      {!rows.length ? <Empty>No entries.</Empty> : (
        <div className="-m-4 overflow-x-auto">
          <table className="table min-w-[560px]">
            <thead><tr><th>When</th><th>Photo</th><th>Result</th><th>Flags / note</th><th>Source</th><th></th></tr></thead>
            <tbody>{visible.map(e => (
              <tr key={e.id}>
                <td className="whitespace-nowrap">{fmtDateTime(e.time)}</td>
                <td>{thumbMap[e.id] ? <img src={thumbMap[e.id]} alt="" className="h-12 w-12 object-cover rounded border border-line" /> : <span className="text-[10px] text-muted" title="Photo stays on the device that captured it">{e.source === 'seed' ? '—' : 'on other device'}</span>}</td>
                <td><BristolBadge type={e.bristol_type} group={e.bristol_group} conf={e.overridden ? null : e.bristol_type != null ? e.type_conf : e.group_conf} />{e.overridden && <div className="text-[10px] text-muted">override (model: {e.model_type ? `type ${e.model_type}` : e.model_group != null ? GROUP_LABEL[e.model_group] : '?'})</div>}</td>
                <td className="text-xs">{e.flags.length ? <span className="text-urgent font-medium">{e.flags.map(f => FLAG_LABEL[f] ?? f).join(', ')}</span> : null}{e.note && <div className="text-muted">{e.note}</div>}</td>
                <td className="text-xs text-muted">{e.source}</td>
                <td className="text-right"><button className="text-xs text-muted hover:text-urgent" onClick={() => del(e)}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ---------------- Record drop box ---------------- */
const KINDS = Object.keys(DOC_KIND_LABEL) as DocKind[]
function guessKind(name: string): DocKind {
  const n = name.toLowerCase()
  if (/mar|med|rx|prescri/.test(n)) return 'mar'
  if (/menu|diet|intake|meal/.test(n)) return 'menu'
  if (/lab|vital/.test(n)) return 'lab'
  if (/note|progress/.test(n)) return 'note'
  if (/chart|history|h&p|admission/.test(n)) return 'chart'
  return 'other'
}

function DropBox({ id, docs, onChange }: { id: string; docs: PatientDocument[]; onChange: () => void }) {
  const [kind, setKind] = useState<DocKind | 'auto'>('auto')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const ingest = async (files: FileList | File[]) => {
    setErr(null)
    for (const f of Array.from(files)) {
      const k = kind === 'auto' ? guessKind(f.name) : kind
      setBusy(`Reading ${f.name}…`)
      try {
        if (f.type.startsWith('image/')) {
          const image_data_url = await imageToDataUrl(f)
          setBusy(`Extracting ${f.name} with AI (image)…`)
          await api.addDocument(id, { kind: k, filename: f.name, mime: f.type, image_data_url })
        } else {
          const text = f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? await pdfToText(f) : await f.text()
          if (!text.trim()) throw new Error(`${f.name}: no text found (scanned PDF? upload it as an image instead)`)
          setBusy(`Extracting ${f.name} with AI…`)
          await api.addDocument(id, { kind: k, filename: f.name, mime: f.type || 'text/plain', text })
        }
      } catch (e: any) { setErr(e.message); break }
    }
    setBusy(null); onChange()
  }
  const submitPaste = async () => {
    if (!pasteText.trim()) return
    setBusy('Extracting pasted text with AI…'); setErr(null)
    try { await api.addDocument(id, { kind: kind === 'auto' ? 'note' : kind, filename: 'pasted text', mime: 'text/plain', text: pasteText }); setPasteText(''); setPasting(false); onChange() } catch (e: any) { setErr(e.message) } finally { setBusy(null) }
  }
  const del = async (d: PatientDocument) => { if (!confirm(`Remove ${d.filename ?? 'document'}?`)) return; await api.deleteDocument(id, d.id); onChange() }

  return (
    <Card title="Record drop box" right={<span className="text-xs text-muted">{docs.length} on file</span>}>
      <label className="block border-2 border-dashed border-navy-100 rounded-md p-4 text-center cursor-pointer hover:bg-navy-50/60"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); ingest(e.dataTransfer.files) }}>
        <div className="text-navy-700 flex justify-center"><FileTextIcon /></div>
        <div className="text-sm font-medium">Drop chart, MAR, menu, notes</div>
        <div className="text-xs text-muted">PDF, text/markdown, CSV, or a photo of the page</div>
        <input type="file" multiple accept=".pdf,.txt,.md,.csv,.json,image/*" className="hidden" onChange={e => { if (e.target.files) ingest(e.target.files); e.target.value = '' }} />
      </label>
      <div className="mt-2 flex gap-2 items-center">
        <select className="input !min-h-8 !py-1 text-xs" value={kind} onChange={e => setKind(e.target.value as any)}>
          <option value="auto">Type: detect from filename</option>
          {KINDS.map(k => <option key={k} value={k}>{DOC_KIND_LABEL[k]}</option>)}
        </select>
        <button className="btn-ghost !min-h-8 !py-1 text-xs" onClick={() => setPasting(v => !v)}>Paste text</button>
      </div>
      {pasting && <div className="mt-2 space-y-2"><textarea className="input h-28" value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste a nursing note, MAR excerpt, or menu…" /><button className="btn-primary !min-h-8 !py-1 text-xs" onClick={submitPaste} disabled={!!busy}>Add</button></div>}
      {busy && <div className="mt-2 text-xs text-navy-700 flex items-center gap-2"><Spinner /> {busy}</div>}
      {err && <div className="mt-2"><ErrorBox error={err} /></div>}

      <ul className="mt-3 divide-y divide-line">
        {docs.length > 0 && <li className="pb-1 text-[11px] text-muted">Tap a file to see what was extracted.</li>}
        {docs.map(d => (
          <li key={d.id} className="py-2">
            <div className="flex items-center gap-2">
              <span className="chip">{DOC_KIND_LABEL[d.kind] ?? d.kind}</span>
              <button className="text-sm font-medium truncate text-left hover:underline" onClick={() => setOpen(open === d.id ? null : d.id)}>{d.filename ?? 'document'}</button>
              <span className="ml-auto text-[11px] text-muted whitespace-nowrap">{fmtDate(d.created_at)}</span>
              <button className="text-xs text-muted hover:text-urgent" onClick={() => del(d)}>✕</button>
            </div>
            {open === d.id && d.extracted && (
              <div className="mt-2 text-xs space-y-1.5 bg-navy-50/60 rounded p-2">
                <p className="text-ink">{d.extracted.summary}</p>
                {d.extracted.medications.length > 0 && <div><span className="label">Medications</span><ul className="list-disc pl-4">{d.extracted.medications.map((m, i) => <li key={i}>{m.name}{m.dose ? ` ${m.dose}` : ''}{m.frequency ? ` ${m.frequency}` : ''}{m.prn ? ' PRN' : ''}{m.drug_class ? <span className="text-muted"> · {m.drug_class}</span> : null}{m.started ? <span className="text-muted"> · {m.started}</span> : null}</li>)}</ul></div>}
                {d.extracted.diagnoses.length > 0 && <div><span className="label">Diagnoses</span><div>{d.extracted.diagnoses.join('; ')}</div></div>}
                {(d.extracted.diet.description || d.extracted.diet.fiber_level !== 'unknown') && <div><span className="label">Diet</span><div>{d.extracted.diet.description} · fibre {d.extracted.diet.fiber_level} · fluids {d.extracted.diet.fluid_intake}{d.extracted.diet.notes ? ` · ${d.extracted.diet.notes}` : ''}</div></div>}
                {d.extracted.mobility && <div><span className="label">Mobility</span><div>{d.extracted.mobility}</div></div>}
                {d.extracted.recent_changes.length > 0 && <div><span className="label">Recent changes</span><ul className="list-disc pl-4">{d.extracted.recent_changes.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                {d.extracted.labs.length > 0 && <div><span className="label">Labs</span><div>{d.extracted.labs.map(l => `${l.name} ${l.value}${l.date ? ` (${l.date})` : ''}`).join('; ')}</div></div>}
                {d.raw_text && <details><summary className="cursor-pointer text-muted">Source text</summary><pre className="whitespace-pre-wrap font-sans text-[11px] max-h-48 overflow-auto">{d.raw_text}</pre></details>}
              </div>
            )}
          </li>
        ))}
        {!docs.length && <li className="py-3 text-xs text-muted text-center">No records yet. The chart and MAR give the rules engine and the AI something to reason with.</li>}
      </ul>
    </Card>
  )
}

/* ---------------- Record summary ---------------- */
/** "new" if the start date parses and is within the last 45 days, or the text says new/recently. */
function isRecent(started: string | null): boolean {
  if (!started) return false
  if (/\b(new|recent|yesterday|today)/i.test(started)) return true
  const m = started.match(/(20\d\d)-(\d\d)(?:-(\d\d))?/)
  if (!m) return false
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 15))
  const days = (Date.now() - +d) / 86_400_000
  return days >= -1 && days <= 45
}
function RecordSummary({ docs }: { docs: PatientDocument[] }) {
  const meds = new Map<string, { name: string; cls: string | null; started: string | null; prn: boolean }>()
  const dx = new Set<string>(), allergies = new Set<string>(), changes: string[] = []
  let diet: ExtractedDoc['diet'] | null = null
  let mobility: string | null = null
  for (const d of docs) {
    const x = d.extracted; if (!x) continue
    for (const m of x.medications) if (!meds.has(m.name.toLowerCase())) meds.set(m.name.toLowerCase(), { name: m.name, cls: m.drug_class, started: m.started, prn: m.prn })
    x.diagnoses.forEach(v => dx.add(v)); x.allergies.forEach(v => allergies.add(v)); changes.push(...x.recent_changes)
    if (!diet && (x.diet.description || x.diet.fiber_level !== 'unknown')) diet = x.diet
    if (!mobility && x.mobility) mobility = x.mobility
  }
  if (!docs.length) return null
  return (
    <Card title="Record at a glance">
      <div className="space-y-3 text-sm">
        <div><div className="label mb-1">Medications ({meds.size})</div><div className="flex flex-wrap gap-1">{[...meds.values()].map(m => <span key={m.name} className="chip" title={m.cls ?? ''}>{m.name}{m.prn ? ' (PRN)' : ''}{isRecent(m.started) ? <span className="ml-1 text-teal-600 font-semibold">new</span> : null}</span>)}{!meds.size && <span className="text-muted text-xs">none extracted</span>}</div></div>
        {changes.length > 0 && <div><div className="label mb-1">Recent changes</div><ul className="list-disc pl-4 text-sm space-y-0.5">{changes.slice(0, 6).map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
        <Collapsible label="Problems, diet, mobility, allergies" openLabel="Hide">
          <div className="space-y-3 pt-1">
            {dx.size > 0 && <div><div className="label mb-1">Problem list</div><div className="text-sm">{[...dx].join(' · ')}</div></div>}
            {diet && <div><div className="label mb-1">Diet</div><div className="text-sm">{diet.description} <span className="text-muted">· fibre {diet.fiber_level} · fluids {diet.fluid_intake}</span></div></div>}
            {mobility && <div><div className="label mb-1">Mobility</div><div className="text-sm">{mobility}</div></div>}
            {allergies.size > 0 && <div><div className="label mb-1">Allergies</div><div className="text-sm text-urgent">{[...allergies].join(', ')}</div></div>}
          </div>
        </Collapsible>
      </div>
    </Card>
  )
}
