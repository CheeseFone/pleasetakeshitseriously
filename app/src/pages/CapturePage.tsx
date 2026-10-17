import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { BristolGroup, EntryFlag, StoolEntry, PatientDetail } from '../../shared/types'
import { ENTRY_FLAGS, FLAG_LABEL, GROUP_LABEL, GROUP_OF_TYPE } from '../../shared/types'
import { api } from '../lib/api'
import { classify, loadModels, type ClassifyResult } from '../lib/model'
import { photoTime } from '../lib/exif'
import { thumbs, deviceId } from '../lib/idb'
import { BRISTOL_DESC } from '../lib/format'
import { BristolBadge, Card, Spinner, ErrorBox, Collapsible, SourcePill } from '../components/ui'
import { Camera, Upload } from '../components/icons'

interface Item {
  id: string
  file: File
  time: Date
  timeSource: 'exif' | 'file'
  status: 'queued' | 'running' | 'done' | 'error'
  error?: string
  result?: ClassifyResult
  type: number | null       // final (after override)
  group: BristolGroup | null
  overridden: boolean
  flags: EntryFlag[]
  note: string
}

function summary(items: Item[]): string {
  const done = items.filter(i => i.status === 'done' && i.group != null)
  if (!done.length) return ''
  const c = [0, 0, 0]; done.forEach(i => { c[i.group as number]++ })
  return [c[0] && `${c[0]} constipated`, c[1] && `${c[1]} normal`, c[2] && `${c[2]} loose`].filter(Boolean).join(' · ')
}
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

export default function CapturePage() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [patient, setPatient] = useState<PatientDetail['patient'] | null>(null)
  const [prevStatus, setPrevStatus] = useState<PatientDetail['status'] | null>(null)
  const [prevTop, setPrevTop] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [modelMsg, setModelMsg] = useState('Preparing on-device model…')
  const [modelReady, setModelReady] = useState(false)
  const [modelErr, setModelErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => { api.patient(id).then(d => { setPatient(d.patient); setPrevStatus(d.status); setPrevTop(d.findings[0] && d.findings[0].severity !== 'info' ? d.findings[0].title : null) }).catch(() => setPatient(null)) }, [id])
  useEffect(() => { loadModels(setModelMsg).then(() => setModelReady(true)).catch(e => setModelErr(e.message)) }, [])

  const update = (iid: string, patch: Partial<Item>) => setItems(xs => xs.map(x => (x.id === iid ? { ...x, ...patch } : x)))

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|heic|webp)$/i.test(f.name))
    const newItems: Item[] = []
    for (const f of list) {
      const { time, source } = await photoTime(f)
      newItems.push({ id: crypto.randomUUID(), file: f, time, timeSource: source, status: 'queued', type: null, group: null, overridden: false, flags: [], note: '' })
    }
    newItems.sort((a, b) => +a.time - +b.time)
    setItems(xs => [...xs, ...newItems])
    for (const it of newItems) {
      queue.current = queue.current.then(async () => {
        update(it.id, { status: 'running' })
        try {
          const r = await classify(it.file)
          update(it.id, { status: 'done', result: r, type: r.type, group: r.group })
        } catch (e: any) { update(it.id, { status: 'error', error: e.message }) }
      })
    }
  }

  const setType = (it: Item, v: string) => {
    if (v === '') { update(it.id, { type: it.result?.type ?? null, group: it.result?.group ?? null, overridden: false }); return }
    const t = Number(v)
    update(it.id, { type: t, group: GROUP_OF_TYPE(t), overridden: t !== it.result?.type || GROUP_OF_TYPE(t) !== it.result?.group })
  }
  const toggleFlag = (it: Item, f: EntryFlag) => update(it.id, { flags: it.flags.includes(f) ? it.flags.filter(x => x !== f) : [...it.flags, f] })

  const ready = items.filter(i => i.status === 'done' && i.group != null)
  const save = async () => {
    setSaving(true); setSaveErr(null)
    try {
      const entries: Partial<StoolEntry>[] = ready.map(i => ({
        id: i.id, time: i.time.toISOString(), bristol_group: i.group, bristol_type: i.type,
        group_conf: i.result?.groupConf ?? null, type_conf: i.result?.typeConf ?? null,
        model_group: i.result?.group ?? null, model_type: i.result?.typeRaw ?? null,
        overridden: i.overridden, flags: i.flags, note: i.note || null, source: items.length > 1 ? 'bulk' : 'camera', device_id: deviceId(),
      }))
      await api.addEntries(id, entries)
      await Promise.all(ready.map(i => thumbs.put(i.id, i.result!.thumb)))
      nav(`/patients/${id}`, { state: { added: ready.length, prevStatus, prevTop } })
    } catch (e: any) { setSaveErr(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link to={`/patients/${id}`} className="text-sm text-navy-700 hover:underline">← {patient?.name ?? 'Resident'}{patient?.room ? ` · ${patient.room}` : ''}</Link>
        <h1 className="text-xl font-semibold">Log stool</h1>
        <div className="ml-auto text-xs flex items-center gap-2">
          {modelErr ? <span className="text-urgent">{modelErr}</span> : <><span className={`h-2 w-2 rounded-full ${modelReady ? 'bg-stable' : 'bg-watch animate-pulse'}`} />{modelMsg}</>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="card p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-navy-50/60 border-dashed">
          <span className="text-navy-700"><Camera size={30} /></span><span className="font-medium">Take a photo</span><span className="text-xs text-muted">Opens the camera on tablets and phones</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        </label>
        <label className="card p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-navy-50/60 border-dashed"
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
          <span className="text-navy-700"><Upload size={30} /></span><span className="font-medium">Bulk upload photos</span><span className="text-xs text-muted">Several days at once — time is read from each photo's EXIF data</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>
      <ol className="card px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
        {['Photo taken', 'Scored on this device, photo not uploaded', 'Type + time saved to the record', 'Risk rules re-run'].map((t, i) => (
          <li key={i} className="flex items-center gap-1.5"><span className="h-5 w-5 rounded-full bg-navy-700 text-white text-[10px] font-semibold flex items-center justify-center">{i + 1}</span>{t}{i < 3 && <span className="hidden sm:inline text-line ml-3">→</span>}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted px-1">
        <span className="font-semibold text-ink/70">Bristol scale:</span>
        <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-b-hard mr-1 align-middle" />1–2 hard, constipated</span>
        <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-b-normal mr-1 align-middle" />3–5 normal</span>
        <span><span className="inline-block h-2.5 w-2.5 rounded-sm bg-b-loose mr-1 align-middle" />6–7 loose, diarrhoea</span>
      </div>

      {items.length > 0 && (
        <Card title={`Review ${items.length} photo${items.length === 1 ? '' : 's'}`} right={<div className="flex items-center gap-3"><span className="text-xs text-muted">{summary(items)}</span><button className="btn-ghost !min-h-8 !py-1 text-xs" onClick={() => setItems([])}>Clear</button></div>}>
          <ul className="divide-y divide-line -m-4">
            {items.map(it => (
              <li key={it.id} className="p-3 sm:p-4 flex gap-3">
                <div className="relative shrink-0">
                  {it.result ? <img src={it.result.thumb} alt="" className="w-24 h-24 sm:w-28 sm:h-28 object-cover rounded border border-line" /> : <div className="w-24 h-24 sm:w-28 sm:h-28 rounded border border-line bg-navy-50 flex items-center justify-center text-muted">{it.status === 'error' ? '⚠' : <Spinner />}</div>}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    {it.status === 'done' && it.result && (it.group != null
                      ? <BristolBadge type={it.type} group={it.group} conf={it.overridden ? null : it.type != null ? it.result.typeConf : it.result.groupConf} />
                      : <span className="pill bg-nodata-bg text-nodata">No stool detected</span>)}
                    {it.status === 'done' && it.result && <span className="text-xs text-muted"><SourcePill kind="device" /> {it.result.ms} ms</span>}
                    {it.overridden && <span className="text-xs text-muted">edited by nurse</span>}
                    {it.status === 'error' && <span className="text-urgent text-sm">{it.error}</span>}
                    {it.status !== 'done' && it.status !== 'error' && <span className="text-sm text-muted">{it.status === 'running' ? 'Analysing…' : 'Queued'}</span>}
                    <button className="ml-auto text-xs text-muted hover:text-urgent min-h-[32px]" onClick={() => setItems(xs => xs.filter(x => x.id !== it.id))}>Remove</button>
                  </div>
                  <div className="text-sm">
                    {it.time.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    <span className="text-xs text-muted"> · {it.timeSource === 'exif' ? 'from photo' : 'file date, please check'}</span>
                  </div>
                  {it.flags.length > 0 && <div className="text-xs text-urgent font-medium">{it.flags.map(f => FLAG_LABEL[f]).join(', ')}</div>}
                  {it.status === 'done' && (
                    <Collapsible label={it.group == null ? 'Set type manually' : 'Flags, note, or correct the type'} openLabel="Done">
                      <div className="space-y-2 pt-1">
                        <div className="flex flex-wrap gap-1.5">
                          {ENTRY_FLAGS.map(f => (
                            <button key={f} type="button" onClick={() => toggleFlag(it, f)} className={`rounded-full border px-2.5 py-1 text-xs min-h-[32px] ${it.flags.includes(f) ? 'bg-navy-700 text-white border-navy-700' : 'bg-white border-line text-ink hover:bg-navy-50'}`}>{FLAG_LABEL[f]}</button>
                          ))}
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <label><span className="label">Bristol type</span>
                            <select className="input" value={it.overridden ? String(it.type) : ''} onChange={e => setType(it, e.target.value)}>
                              <option value="">{it.result?.type ? `Model: type ${it.result.type}` : it.result?.group != null ? `Model: ${GROUP_LABEL[it.result.group]}${it.result.typeRaw ? ` (leaned type ${it.result.typeRaw})` : ''}` : 'Model: none'}</option>
                              {[1, 2, 3, 4, 5, 6, 7].map(t => <option key={t} value={t}>Type {t} — {BRISTOL_DESC[t]}</option>)}
                            </select></label>
                          <label><span className="label">Time</span>
                            <input type="datetime-local" className="input" value={toLocalInput(it.time)} onChange={e => update(it.id, { time: new Date(e.target.value) })} /></label>
                          <label><span className="label">Note</span><input className="input" value={it.note} onChange={e => update(it.id, { note: e.target.value })} placeholder="optional" /></label>
                        </div>
                      </div>
                    </Collapsible>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {items.length > 0 && (
        <div className="sticky bottom-0 bg-canvas/95 backdrop-blur py-3 flex items-center gap-3 border-t border-line">
          {saveErr && <ErrorBox error={saveErr} />}
          <span className="text-sm text-muted">{ready.length} of {items.length} ready</span>
          <button className="btn-primary ml-auto" disabled={!ready.length || saving || items.some(i => i.status === 'running' || i.status === 'queued')} onClick={save}>{saving ? <Spinner /> : `Save ${ready.length} entr${ready.length === 1 ? 'y' : 'ies'}`}</button>
        </div>
      )}
    </div>
  )
}
