// POST /api/admin/seed  — wipes all data and loads the demo residents (entries dated relative to now).
// If SEED_TOKEN is set on the server, the request must carry header  x-seed-token: <value>.
import { handle, json, HttpError } from '../../_lib/env'
import { db, ensureSchema, pgTextArray } from '../../_lib/db'
import demo from '../../_lib/demo-data.json'
import { GROUP_OF_TYPE } from '../../../shared/types'

const DAY = 86_400_000

export const onRequestPost = handle(async ctx => {
  if (ctx.env.SEED_TOKEN && ctx.request.headers.get('x-seed-token') !== ctx.env.SEED_TOKEN) throw new HttpError(403, 'Bad seed token')
  const sql = db(ctx)
  await ensureSchema(sql)
  const now = new Date()
  // "day 0" is today at local-ish wall-clock; times in patient.json are treated as UTC-ish clock times.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  let entries = 0, docs = 0
  await sql.begin(async sql => {
  await sql`delete from patients`
  for (const p of demo as any[]) {
    await sql`insert into patients (id, name, room, dob, sex, summary) values (${p.id}, ${p.name}, ${p.room}, ${p.dob}, ${p.sex}, ${p.summary})`
    for (const d of p.docs) {
      await sql`insert into documents (patient_id, kind, filename, mime, raw_text, extracted, created_at)
        values (${p.id}, ${d.kind}, ${d.file}, ${'text/markdown'}, ${d.text}, ${sql.json(d.extracted)}, ${new Date(+today - 4 * DAY).toISOString()})`
      docs++
    }
    for (const e of p.entries) {
      const [h, m] = e.time.split(':').map(Number)
      let t = new Date(+today + e.day * DAY + (h * 60 + m) * 60_000)
      if (+t > +now) t = new Date(+now - 10 * 60_000) // never in the future
      const type = e.type as number
      const seedConf = () => Math.round((0.72 + Math.random() * 0.25) * 100) / 100
      await sql`insert into stool_entries (time, patient_id, bristol_group, bristol_type, group_conf, type_conf, model_group, model_type, overridden, flags, note, source)
        values (${t.toISOString()}, ${p.id}, ${GROUP_OF_TYPE(type)}, ${type}, ${seedConf()}, ${seedConf()}, ${GROUP_OF_TYPE(type)}, ${type}, false, ${pgTextArray(e.flags ?? [])}::text[], ${e.note ?? null}, 'seed')`
      entries++
    }
  }
  })
  return json({ ok: true, patients: demo.length, documents: docs, entries, seeded_at: now.toISOString() })
})
