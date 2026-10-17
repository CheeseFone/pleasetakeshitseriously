import type { Sql } from './db'
import type { Patient, StoolEntry, PatientDocument, Analysis, PatientDetail, PatientRosterRow } from '../../shared/types'
import { evaluate, statusOf } from '../../shared/rules'

// fetch_types is off, so text[] arrives as a Postgres literal like {straining,"low_fluids"}
const pgArr = (v: unknown): string[] => Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/^\{|\}$/g, '').split(',').filter(Boolean).map(x => x.replace(/^"|"$/g, '')) : []

const entryRow = (r: any): StoolEntry => ({
  id: r.id, patient_id: r.patient_id, time: r.time, bristol_group: r.bristol_group, bristol_type: r.bristol_type,
  group_conf: r.group_conf, type_conf: r.type_conf, model_group: r.model_group, model_type: r.model_type,
  overridden: !!r.overridden, flags: pgArr(r.flags) as StoolEntry['flags'], note: r.note, source: r.source, device_id: r.device_id,
})

export async function listPatients(sql: Sql): Promise<PatientRosterRow[]> {
  const patients = (await sql`select id, name, room, dob::text as dob, sex, summary, created_at from patients order by room nulls last, name`) as unknown as Patient[]
  const entries = (await sql`select * from stool_entries where time > now() - interval '30 days' order by time`).map(entryRow)
  const docs = (await sql`select * from documents`) as unknown as PatientDocument[]
  const now = new Date()
  return patients.map(p => {
    const es = entries.filter(e => e.patient_id === p.id)
    const ds = docs.filter(d => d.patient_id === p.id)
    const findings = evaluate(es, ds, now)
    const top = findings[0]
    const last = es[es.length - 1]
    const cutoff14 = +now - 14 * 86_400_000
    return {
      ...p,
      status: statusOf(findings, es.length),
      top_finding: top && top.severity !== 'info' ? top.title : null,
      top_expected: top && top.severity !== 'info' ? top.expected : null,
      last_bm: last?.time ?? null,
      entry_count_7d: es.filter(e => +new Date(e.time) > +now - 7 * 86_400_000).length,
      recent_types: es.filter(e => +new Date(e.time) > cutoff14).map(e => e.bristol_type),
    }
  })
}

export async function getPatient(sql: Sql, id: string): Promise<PatientDetail | null> {
  const [p] = (await sql`select id, name, room, dob::text as dob, sex, summary, created_at from patients where id = ${id}`) as unknown as Patient[]
  if (!p) return null
  const entries = (await sql`select * from stool_entries where patient_id = ${id} and time > now() - interval '90 days' order by time`).map(entryRow)
  const documents = (await sql`select * from documents where patient_id = ${id} order by created_at desc`) as unknown as PatientDocument[]
  const [analysis] = (await sql`select * from analyses where patient_id = ${id} order by created_at desc limit 1`) as unknown as Analysis[]
  // Timescale time_bucket: one row per day for the trend chart
  const daily = (await sql`
    select time_bucket('1 day', time)::date::text as day, count(*)::int as n,
           avg(bristol_type)::float as avg_type,
           count(*) filter (where bristol_group = 2)::int as loose,
           count(*) filter (where bristol_group = 0)::int as hard
    from stool_entries where patient_id = ${id} and time > now() - interval '30 days'
    group by 1 order by 1`) as unknown as PatientDetail['daily']
  const findings = evaluate(entries, documents)
  return { patient: p, entries, documents, findings, status: statusOf(findings, entries.length), analysis: analysis ?? null, daily }
}
