import { useState, type ReactNode } from 'react'
import type { Finding, PatientStatus, Severity, BristolGroup } from '../../shared/types'
import { GROUP_LABEL } from '../../shared/types'
import { STATUS_LABEL, statusClass, groupClass, BRISTOL_DESC, typeColor } from '../lib/format'
import { Cog, Sparkles, Lock } from './icons'

export const Spinner = ({ className = '' }: { className?: string }) => <span className={`spinner ${className}`} aria-label="loading" />

export function StatusPill({ status }: { status: PatientStatus | Severity }) {
  const label = status in STATUS_LABEL ? STATUS_LABEL[status as PatientStatus] : status === 'info' ? 'Info' : status
  return <span className={`pill ${statusClass(status)}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{label}</span>
}

export function BristolBadge({ type, group, conf }: { type: number | null; group: BristolGroup | null; conf?: number | null }) {
  const g = group ?? (type != null ? (type <= 2 ? 0 : type <= 5 ? 1 : 2) : null)
  return (
    <span className={`pill ${groupClass(g as BristolGroup | null)}`} title={type ? BRISTOL_DESC[type] : undefined}>
      {type != null ? `Type ${type}` : g != null ? GROUP_LABEL[g as BristolGroup] : 'Unknown'}
      {type != null && g != null && <span className="font-normal opacity-80">· {GROUP_LABEL[g as BristolGroup]}</span>}
      {conf != null && <span className="font-normal opacity-70">{Math.round(conf * 100)}%</span>}
    </span>
  )
}

/** 14-day mini chart of Bristol types: bars from 1 to 7, coloured by group. */
export function Sparkline({ types }: { types: (number | null)[] }) {
  const xs = types.slice(-14)
  if (!xs.length) return <span className="text-xs text-muted">—</span>
  return (
    <svg width={xs.length * 7 + 2} height="22" className="block" aria-hidden>
      <line x1="0" x2={xs.length * 7 + 2} y1="11" y2="11" stroke="#e2e8f0" />
      {xs.map((t, i) => t == null ? null : (
        <rect key={i} x={i * 7 + 1} y={22 - t * 3} width="5" height={t * 3} rx="1" fill={typeColor(t)} />
      ))}
    </svg>
  )
}

export function Card({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <div className="card-h"><h2 className="card-t">{title}</h2>{right}</div>}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Collapsible({ label, openLabel, children, defaultOpen = false, className = '' }: { label: string; openLabel?: string; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen(v => !v)} className="text-sm text-navy-700 font-medium hover:underline inline-flex items-center gap-1 min-h-[36px]">
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>{open ? (openLabel ?? label) : label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}

const TAG_CLASS: Record<string, string> = { Log: 'bg-teal-100 text-teal-600', MAR: 'bg-navy-100 text-navy-800', Chart: 'bg-purple-100 text-purple-800', Diet: 'bg-amber-100 text-amber-800' }
/** Renders a "[Source] text" explanation line with the source as a small chip. */
export function Evidence({ text }: { text: string }) {
  const m = text.match(/^\[(Log|MAR|Chart|Diet)\]\s*(.*)$/s)
  if (!m) return <>{text}</>
  const label = { Log: 'Bowel log', MAR: 'MAR', Chart: 'Chart', Diet: 'Diet record' }[m[1]]
  return <><span className={`inline-block rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide mr-1.5 align-middle ${TAG_CLASS[m[1]]}`}>{label}</span>{m[2]}</>
}

export function SourcePill({ kind }: { kind: 'rules' | 'ai' | 'device' }) {
  const t = { rules: ['Rule engine', 'Deterministic rules over the bowel log and the records. Same input, same answer, no API.'], ai: ['AI reasoning', 'Large language model reading the log, records and rule findings.'], device: ['On this device', 'Analysed in the browser. The photo was not uploaded.'] }[kind]
  const Icon = { rules: Cog, ai: Sparkles, device: Lock }[kind]
  return <span className="pill bg-white border border-line text-muted font-medium" title={t[1]}><Icon size={12} />{t[0]}</span>
}

export function FindingCard({ f, defaultOpen = false }: { f: Finding; defaultOpen?: boolean }) {
  const border = { urgent: 'border-l-urgent', high: 'border-l-high', watch: 'border-l-watch', info: 'border-l-stable' }[f.severity]
  return (
    <article className={`card border-l-4 ${border} p-4`}>
      <div className="flex items-center gap-2 flex-wrap">
        <StatusPill status={f.severity} />
        <span className="ml-auto order-last"><SourcePill kind="rules" /></span>
        {f.expected === true && <span className="pill bg-navy-50 text-navy-800">Explained by record</span>}
        {f.expected === false && <span className="pill bg-urgent-bg text-urgent">Unexplained — investigate</span>}
      </div>
      <h3 className="mt-2 font-semibold text-base leading-snug">{f.title}</h3>
      <p className="text-sm text-muted mt-1">{f.summary}</p>
      {(f.why.length > 0 || f.suggested.length > 0) && (
        <Collapsible label="Why, and what to do" openLabel="Hide details" defaultOpen={defaultOpen} className="mt-2">
          <div className="grid gap-4 md:grid-cols-2 pt-1">
            <div>
              <div className="label mb-1.5">Why it's flagged</div>
              <ul className="text-sm space-y-1.5 pl-0 list-none">{f.why.map((w, i) => <li key={i}><Evidence text={w} /></li>)}</ul>
            </div>
            {f.suggested.length > 0 && (
              <div>
                <div className="label mb-1.5">Suggested next steps</div>
                <ul className="text-sm space-y-1.5 list-[square] pl-4 marker:text-teal-600">{f.suggested.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
          </div>
        </Collapsible>
      )}
    </article>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-muted text-center py-6 border border-dashed border-line rounded">{children}</div>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded border border-urgent/30 bg-urgent-bg text-urgent text-sm px-3 py-2 flex items-center gap-3">
      <span className="flex-1 break-words">{error}</span>
      {onRetry && <button className="btn-ghost !min-h-8 !py-1" onClick={onRetry}>Retry</button>}
    </div>
  )
}
