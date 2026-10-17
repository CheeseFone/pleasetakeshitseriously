import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { thumbs } from '../lib/idb'
import { loadModels, modelsCached } from '../lib/model'
import { Card, Spinner, ErrorBox } from '../components/ui'

export default function SettingsPage() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null)
  const [hErr, setHErr] = useState<string | null>(null)
  const [cached, setCached] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [thumbCount, setThumbCount] = useState<number | null>(null)

  useEffect(() => {
    api.health().then(setHealth).catch(e => setHErr(e.message))
    modelsCached().then(setCached)
    thumbs.keys().then(k => setThumbCount(k.length))
  }, [])

  const run = async (name: string, fn: () => Promise<string>) => {
    setBusy(name); setMsg('')
    try { setMsg(await fn()) } catch (e: any) { setMsg('Error: ' + e.message) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-xl font-semibold">Settings & system status</h1>

      <Card title="Connections">
        {hErr ? <ErrorBox error={hErr} /> : !health ? <Spinner /> : (
          <dl className="grid grid-cols-[160px_1fr] gap-y-1.5 text-sm">
            <dt className="text-muted">Database</dt><dd>{health.db ? <span className="text-stable font-medium">Connected</span> : <span className="text-urgent">Not connected — {health.dbError}</span>} {health.timescaledb && <span className="text-muted">· TimescaleDB {health.timescaledb} (Tiger Cloud)</span>}</dd>
            <dt className="text-muted">AI analysis</dt><dd>{health.openai ? <span className="text-stable font-medium">Configured</span> : <span className="text-high">OPENAI_API_KEY not set — Analyse and document extraction will fail</span>} <span className="text-muted">· model {health.model}</span></dd>
          </dl>
        )}
      </Card>

      <Card title="This device">
        <dl className="grid grid-cols-[160px_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted">Stool models</dt>
          <dd className="flex items-center gap-3 flex-wrap">{cached == null ? '…' : cached ? <span className="text-stable font-medium">Cached on device (works offline)</span> : 'Not downloaded yet'}
            <button className="btn-ghost !min-h-8 !py-1 text-xs" disabled={busy != null} onClick={() => run('models', async () => { await loadModels(m => setMsg(m)); setCached(true); return 'Models loaded and cached.' })}>{busy === 'models' ? <Spinner /> : 'Download now'}</button></dd>
          <dt className="text-muted">Local photo thumbnails</dt>
          <dd className="flex items-center gap-3 flex-wrap">{thumbCount ?? '…'} stored in this browser only
            <button className="btn-danger !min-h-8 !py-1 text-xs" disabled={busy != null} onClick={() => run('thumbs', async () => { await thumbs.clear(); setThumbCount(0); return 'Local thumbnails deleted.' })}>Delete all</button></dd>
        </dl>
      </Card>

      <Card title="Dashboard">
        <div className="flex items-center gap-3 flex-wrap text-sm"><span className="text-muted">The “How it works” strip on the Residents page can be dismissed.</span>
          <button className="btn-ghost !min-h-8 !py-1 text-xs" onClick={() => { try { localStorage.removeItem('tss-how-dismissed') } catch {} ; setMsg('It will show again on the Residents page.') }}>Show it again</button></div>
      </Card>

      <Card title="Demo data">
        <p className="text-sm text-muted mb-3">Replaces <strong>all</strong> residents, records and entries with the five demo residents (dated relative to today). Use <code>demo/patients/*/photos</code> for the bulk-upload part of the demo.</p>
        <div className="flex gap-2 items-center flex-wrap">
          <input className="input max-w-xs" placeholder="Seed token (only if SEED_TOKEN is set)" value={token} onChange={e => setToken(e.target.value)} />
          <button className="btn-primary" disabled={busy != null} onClick={() => { if (confirm('Replace ALL data with the demo residents?')) run('seed', async () => { const r = await api.seed(token || undefined); return `Seeded ${r.patients} residents and ${r.entries} entries.` }) }}>{busy === 'seed' ? <Spinner /> : 'Load demo residents'}</button>
        </div>
      </Card>

      {msg && <div className="text-sm rounded border border-line bg-white px-3 py-2">{msg}</div>}

      <Card title="Privacy & model">
        <div className="text-sm space-y-2">
          <p><strong>Photos stay on the device.</strong> The Bristol classifier (two YOLO26n-seg models, 11 MB each) runs inside the browser with onnxruntime-web. Only the resulting score, type, flags and time are sent to the database. A small thumbnail is kept in this browser's IndexedDB so staff can see what was logged on this device; other devices see scores only.</p>
          <p><strong>Records.</strong> Text, PDF and chart photos dropped into a resident's record box are sent to the AI model for structuring (the PDF/text is parsed on the device first). Images of charts are not stored; only the extracted text and structure are kept.</p>
          <p><strong>Decision support only.</strong> Take Shit Seriously flags patterns and explains why; it does not diagnose. It has not been validated as a medical device. Clinical judgement always comes first.</p>
          <p className="text-muted">Bristol model trained on the “stool classification” dataset by smartgut on Roboflow Universe (CC BY 4.0), de-duplicated and re-split. Then fine-tuned on 243 crowd-sourced photos with real backgrounds (Bristol-Stool-Boost). On unseen photos of that kind: group correct 70%, exact type correct 69% when shown; on the curated test split: 82% / 74%.</p>
        </div>
      </Card>
    </div>
  )
}
