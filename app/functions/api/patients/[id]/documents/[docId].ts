import { handle, json } from '../../../../_lib/env'
import { db } from '../../../../_lib/db'

export const onRequestDelete = handle<'id' | 'docId'>(async ctx => {
  const sql = db(ctx)
  await sql`delete from documents where patient_id = ${String(ctx.params.id)} and id = ${String(ctx.params.docId)}`
  return json({ ok: true })
})
