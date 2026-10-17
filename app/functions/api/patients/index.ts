import { handle, json, readJson, HttpError } from '../../_lib/env'
import { db, ensureSchema } from '../../_lib/db'
import { listPatients } from '../../_lib/queries'
import type { Patient } from '../../../shared/types'

export const onRequestGet = handle(async ctx => {
  const sql = db(ctx)
  try { return json(await listPatients(sql)) } catch (e: any) {
    if (e?.code !== '42P01') throw e // 42P01 = relation does not exist -> first run on an empty database
    await ensureSchema(sql)
    return json(await listPatients(sql))
  }
})

export const onRequestPost = handle(async ctx => {
  const body = await readJson<Partial<Patient>>(ctx.request)
  if (!body.name?.trim()) throw new HttpError(400, 'name is required')
  const id = body.id?.trim() || body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Math.random().toString(36).slice(2, 6)
  const sql = db(ctx)
  const [p] = await sql`insert into patients (id, name, room, dob, sex, summary)
    values (${id}, ${body.name.trim()}, ${body.room ?? null}, ${body.dob || null}, ${body.sex ?? null}, ${body.summary ?? null})
    returning id, name, room, dob::text as dob, sex, summary, created_at`
  return json(p, 201)
})
