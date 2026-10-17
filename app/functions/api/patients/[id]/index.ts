import { handle, json, HttpError } from '../../../_lib/env'
import { db } from '../../../_lib/db'
import { getPatient } from '../../../_lib/queries'

export const onRequestGet = handle<'id'>(async ctx => {
  const detail = await getPatient(db(ctx), String(ctx.params.id))
  if (!detail) throw new HttpError(404, 'Patient not found')
  return json(detail)
})

export const onRequestDelete = handle<'id'>(async ctx => {
  const sql = db(ctx)
  await sql`delete from patients where id = ${String(ctx.params.id)}`
  return json({ ok: true })
})
