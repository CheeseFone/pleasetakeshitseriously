import { handle, json, HttpError } from '../../../_lib/env'
import { db } from '../../../_lib/db'
import { getPatient } from '../../../_lib/queries'
import { analyzePatient } from '../../../_lib/openai'

export const onRequestPost = handle<'id'>(async ctx => {
  const sql = db(ctx)
  const detail = await getPatient(sql, String(ctx.params.id))
  if (!detail) throw new HttpError(404, 'Patient not found')
  const { result, model } = await analyzePatient(ctx.env, detail)
  const [row] = await sql`insert into analyses (patient_id, model, risk_level, headline, result)
    values (${detail.patient.id}, ${model}, ${result.risk_level}, ${result.headline}, ${sql.json(result as any)}) returning *`
  return json(row, 201)
})
