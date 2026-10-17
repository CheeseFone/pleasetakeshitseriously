import { handle, json } from '../_lib/env'
import { db } from '../_lib/db'

export const onRequestGet = handle(async ctx => {
  let dbOk = false, dbError: string | null = null, tsVersion: string | null = null
  try {
    const sql = db(ctx)
    const [r] = await sql`select extversion from pg_extension where extname = 'timescaledb'`
    tsVersion = r?.extversion ?? null
    dbOk = true
  } catch (e: any) { dbError = e.message }
  return json({ ok: dbOk, db: dbOk, timescaledb: tsVersion, dbError, openai: !!ctx.env.OPENAI_API_KEY, model: ctx.env.OPENAI_MODEL || 'gpt-6-luna' })
})
