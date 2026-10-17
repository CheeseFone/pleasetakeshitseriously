import { useEffect, useState } from 'react'
import { GROUP_LABEL, type BristolGroup } from '../../shared/types'
import { inspect, loadModels, type Inspection, INPUT } from '../lib/model'
import { BRISTOL_DESC, groupClass } from '../lib/format'
import { Card, Spinner, ErrorBox, SourcePill, BristolBadge } from '../components/ui'
import { Camera, Upload, Lock } from '../components/icons'

const SAMPLES = [
  { file: 'hard_type1.jpg', label: 'Hard lumps' }, { file: 'lumpy_type2.jpg', label: 'Lumpy' },
  { file: 'normal_type4.jpg', label: 'Normal' }, { file: 'loose_type6.jpg', label: 'Mushy' }, { file: 'watery_type7.jpg', label: 'Watery' },
]

interface Run { id: string; name: string; status: 'running' | 'done' | 'error'; error?: string; r?: Inspection }

export default function PlaygroundPage() {
  const [modelMsg, setModelMsg] = useState('Preparing on-device models…')
  const [ready, setReady] = useState(false)
  const [modelErr, setModelErr] = useState<string | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [view, setView] = useState<{ model: 'group' | 'type'; masks: boolean; boxes: boolean; all: boolean }>({ model: 'group', masks: true, boxes: true, all: false })

  useEffect(() => { loadModels(setModelMsg).then(() => setReady(true)).catch(e => setModelErr(e.message)) }, [])

  const run = async (blob: Blob, name: string) => {
    const id = crypto.randomUUID()
    setRuns(xs => [{ id, name, status: 'running' }, ...xs])
    try { const r = await inspect(blob); setRuns(xs => xs.map(x => (x.id === id ? { ...x, status: 'done', r } : x))) }
    catch (e: any) { setRuns(xs => xs.map(x => (x.id === id ? { ...x, status: 'error', error: e.message } : x))) }
  }
  const addFiles = (files: FileList | File[]) => { for (const f of Array.from(files)) if (f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name)) run(f, f.name) }
  const sample = async (file: string) => { const res = await fetch(`/samples/${file}`); run(await res.blob(), file) }

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Bristol detector playground</h1>
          <p className="text-sm text-muted">Drop any stool photo. Two YOLO26n-seg models run in this browser and annotate it. Nothing is uploaded.</p>
        </div>
        <div className="ml-auto text-xs flex items-center gap-2">
          {modelErr ? <span className="text-urgent">{modelErr}</span> : <><span className={`h-2 w-2 rounded-full ${ready ? 'bg-stable' : 'bg-watch animate-pulse'}`} />{modelMsg}</>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="card p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-navy-50/60 border-dashed"
          onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}>
          <span className="text-navy-700"><Upload size={30} /></span><span className="font-medium">Drop or choose images</span><span className="text-xs text-muted">JPEG, PNG, HEIC · several at once is fine</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        </label>
        <label className="card p-5 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-navy-50/60 border-dashed">
          <span className="text-navy-700"><Camera size={30} /></span><span className="font-medium">Take a photo</span><span className="text-xs text-muted">Opens the camera on tablets and phones</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium">Try a sample:</span>
        {SAMPLES.map(s => (
          <button key={s.file} className="rounded border border-line overflow-hidden hover:ring-2 hover:ring-navy-600/40 text-left" onClick={() => sample(s.file)} disabled={!ready}>
            <img src={`/samples/${s.file}`} alt={s.label} className="h-14 w-14 object-cover block" /><div className="text-[10px] text-center text-muted py-0.5">{s.label}</div>
          </button>
        ))}
        <span className="text-[11px] text-muted ml-auto">Samples from the CC BY 4.0 training dataset (held-out test split)</span>
      </div>

      {runs.length > 0 && (
        <div className="card p-3 flex items-center gap-4 flex-wrap text-sm">
          <span className="font-medium">Show:</span>
          <div className="flex rounded border border-line overflow-hidden">
            {(['group', 'type'] as const).map(m => <button key={m} className={`px-3 py-1.5 ${view.model === m ? 'bg-navy-700 text-white' : 'bg-white hover:bg-navy-50'}`} onClick={() => setView(v => ({ ...v, model: m }))}>{m === 'group' ? '3-group model' : '7-type model'}</button>)}
          </div>
          {([['masks', 'Masks'], ['boxes', 'Boxes'], ['all', 'All detections (top 5)']] as const).map(([k, l]) => (
            <label key={k} className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={view[k]} onChange={e => setView(v => ({ ...v, [k]: e.target.checked }))} />{l}</label>
          ))}
          <button className="ml-auto text-xs text-muted hover:text-urgent" onClick={() => setRuns([])}>Clear</button>
        </div>
      )}

      {runs.map(x => <RunCard key={x.id} run={x} view={view} />)}

      <Card title="What's under the hood">
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div><div className="font-semibold mb-1">Two segmentation models</div><p className="text-muted">YOLO26n-seg, 11 MB each, exported to ONNX. One answers "constipated / normal / loose" (82% correct on the curated test split, 70% on crowd-sourced phone photos), the other the exact Bristol type 1–7 (74% exact / 87% within one type curated, 49% / 79% crowd-sourced). Trained on 865 de-duplicated photos from the CC BY 4.0 <em>stool classification</em> dataset plus 243 crowd-sourced photos.</p></div>
          <div><div className="font-semibold mb-1">Runs in the browser</div><p className="text-muted">onnxruntime-web (WebAssembly). The photo is resized to {INPUT}×{INPUT}, normalised, and both models run on the device. Models are cached after the first download, so it works offline. <span className="inline-flex items-center gap-1 text-ink"><Lock size={12} /> The photo never leaves the device.</span></p></div>
          <div><div className="font-semibold mb-1">Decision policy</div><p className="text-muted">Headline = top detection of the 3-group model (score &gt; 0.2). The exact type is shown only when the 7-type model scores ≥ 60% <em>and</em> agrees with the group. The mask is sigmoid(coefficients · prototypes) cropped to the box.</p></div>
        </div>
      </Card>
    </div>
  )
}

function RunCard({ run, view }: { run: Run; view: { model: 'group' | 'type'; masks: boolean; boxes: boolean; all: boolean } }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => { if (run.r) setUrl(run.r.draw(view).toDataURL('image/jpeg', 0.9)) }, [run.r, view])
  if (run.status !== 'done' || !run.r) {
    return <div className="card p-4 flex items-center gap-3 text-sm">{run.status === 'error' ? <ErrorBox error={run.error ?? 'failed'} /> : <><Spinner /> Analysing {run.name} on this device…</>}</div>
  }
  const r = run.r, p = r.policy
  const fmt = (ms: number) => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`
  return (
    <section className="card overflow-hidden">
      <div className="card-h"><h2 className="card-t truncate">{run.name}</h2><span className="text-xs text-muted">{r.width}×{r.height} px · <SourcePill kind="device" /></span></div>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="bg-navy-900/95 flex items-center justify-center p-2 min-h-[260px]">{url && <img src={url} alt="annotated" className="max-h-[560px] w-auto max-w-full rounded" />}</div>
        <div className="p-4 space-y-4 text-sm border-t lg:border-t-0 lg:border-l border-line">
          <div>
            <div className="label mb-1">App would record</div>
            <div className="flex items-center gap-2 flex-wrap">
              {p.group != null ? <BristolBadge type={p.type} group={p.group} conf={p.type != null ? p.typeConf : p.groupConf} /> : <span className="pill bg-nodata-bg text-nodata">No stool detected</span>}
            </div>
            <p className="text-xs text-muted mt-1.5">{p.reason}</p>
          </div>
          <DetTable title="3-group model" dets={r.groupDets} label={c => GROUP_LABEL[c as BristolGroup]} cls={c => groupClass(c as BristolGroup)} />
          <DetTable title="7-type model" dets={r.typeDets} label={c => `Type ${c + 1} · ${BRISTOL_DESC[c + 1]}`} cls={c => groupClass(c + 1 <= 2 ? 0 : c + 1 <= 5 ? 1 : 2)} />
          <div>
            <div className="label mb-1">Timing on this device</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs tabular-nums">
              <span className="text-muted">Decode image</span><span>{fmt(r.timings.decode)}</span>
              <span className="text-muted">Resize + normalise</span><span>{fmt(r.timings.preprocess)}</span>
              <span className="text-muted">3-group model</span><span>{fmt(r.timings.group)}</span>
              <span className="text-muted">7-type model</span><span>{fmt(r.timings.type)}</span>
              <span className="font-medium">Total</span><span className="font-medium">{fmt(r.timings.total)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function DetTable({ title, dets, label, cls }: { title: string; dets: Inspection['groupDets']; label: (c: number) => string; cls: (c: number) => string }) {
  return (
    <div>
      <div className="label mb-1">{title} · {dets.length} detection{dets.length === 1 ? '' : 's'} above 0.2</div>
      {dets.length ? (
        <table className="w-full text-xs">
          <tbody>{dets.slice(0, 5).map((d, i) => (
            <tr key={i} className={i === 0 ? 'font-medium' : 'text-muted'}>
              <td className="py-0.5 pr-2"><span className={`pill ${cls(Math.round(d.cls))}`}>{label(Math.round(d.cls))}</span></td>
              <td className="py-0.5 pr-2 tabular-nums text-right">{Math.round(d.score * 100)}%</td>
              <td className="py-0.5 tabular-nums text-muted">box {Math.round(d.x1)},{Math.round(d.y1)} → {Math.round(d.x2)},{Math.round(d.y2)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="text-xs text-muted">none</div>}
    </div>
  )
}
