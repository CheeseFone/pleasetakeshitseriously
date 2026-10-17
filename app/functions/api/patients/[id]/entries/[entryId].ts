import { handle, json, readJson } from '../../../../_lib/env'
import { db, pgTextArray } from '../../../../_lib/db'
import type { StoolEntry } from '../../../../../shared/types'

export const onRequestDelete = handle<'id' | 'entryId'>(async ctx => {
  const sql = db(ctx)
  await sql`delete from stool_entries where patient_id = ${String(ctx.params.id)} and id = ${String(ctx.params.entryId)}`
  return json({ ok: true })
})

export const onRequestPatch = handle<'id' | 'entryId'>(async ctx => {
  const body = await readJson<Partial<StoolEntry>>(ctx.request)
  const sql = db(ctx)
  const [row] = await sql`update stool_entries set
      bristol_group = coalesce(${body.bristol_group ?? null}, bristol_group),
      bristol_type = coalesce(${body.bristol_type ?? null}, bristol_type),
      overridden = coalesce(${body.overridden ?? null}, overridden),
      flags = coalesce(${body.flags ? pgTextArray(body.flags) : null}::text[], flags),
      note = coalesce(${body.note ?? null}, note)
    where patient_id = ${String(ctx.params.id)} and id = ${String(ctx.params.entryId)} returning *`
  return json(row ?? null)
})
