import { handle, json, readJson, HttpError } from '../../../../_lib/env'
import { db, pgTextArray } from '../../../../_lib/db'
import type { StoolEntry } from '../../../../../shared/types'

type NewEntry = Partial<StoolEntry> & { time: string }

export const onRequestPost = handle<'id'>(async ctx => {
  const pid = String(ctx.params.id)
  const body = await readJson<{ entries: NewEntry[] }>(ctx.request)
  const rows = body.entries ?? []
  if (!rows.length) throw new HttpError(400, 'entries[] is empty')
  if (rows.length > 200) throw new HttpError(400, 'Max 200 entries per request')
  const sql = db(ctx)
  const [exists] = await sql`select 1 from patients where id = ${pid}`
  if (!exists) throw new HttpError(404, 'Patient not found')
  const inserted: string[] = []
  for (const e of rows) {
    if (!e.time || isNaN(+new Date(e.time))) throw new HttpError(400, 'Each entry needs a valid ISO time')
    const id = e.id && /^[0-9a-f-]{36}$/i.test(e.id) ? e.id : crypto.randomUUID()
    await sql`insert into stool_entries (time, id, patient_id, bristol_group, bristol_type, group_conf, type_conf, model_group, model_type, overridden, flags, note, source, device_id)
      values (${new Date(e.time).toISOString()}, ${id}, ${pid}, ${e.bristol_group ?? null}, ${e.bristol_type ?? null}, ${e.group_conf ?? null}, ${e.type_conf ?? null},
              ${e.model_group ?? null}, ${e.model_type ?? null}, ${!!e.overridden}, ${pgTextArray(e.flags ?? [])}::text[], ${e.note ?? null}, ${e.source ?? 'manual'}, ${e.device_id ?? null})`
    inserted.push(id)
  }
  return json({ inserted }, 201)
})
