import { handle, json, readJson, HttpError } from '../../../../_lib/env'
import { db } from '../../../../_lib/db'
import { extractDocument } from '../../../../_lib/openai'
import type { DocKind, ExtractedDoc } from '../../../../../shared/types'

interface Body { kind: DocKind; filename?: string; mime?: string; text?: string; image_data_url?: string; extracted?: ExtractedDoc }

export const onRequestPost = handle<'id'>(async ctx => {
  const pid = String(ctx.params.id)
  const body = await readJson<Body>(ctx.request)
  if (!body.kind) throw new HttpError(400, 'kind is required')
  if (body.image_data_url && body.image_data_url.length > 8_000_000) throw new HttpError(413, 'Image too large (max ~6 MB)')
  const sql = db(ctx)
  const [exists] = await sql`select 1 from patients where id = ${pid}`
  if (!exists) throw new HttpError(404, 'Patient not found')

  // Either the client supplies a ready extraction (seed / offline) or we ask the LLM.
  let extracted = body.extracted ?? null
  let model: string | null = null
  if (!extracted) {
    const r = await extractDocument(ctx.env, { kind: body.kind, filename: body.filename, text: body.text, imageDataUrl: body.image_data_url })
    extracted = r.extracted; model = r.model
  }
  // Photos of charts are never stored; we keep only the transcription the model produced.
  const rawText = body.text ?? extracted.transcribed_text ?? null
  const [doc] = await sql`insert into documents (patient_id, kind, filename, mime, raw_text, extracted)
    values (${pid}, ${body.kind}, ${body.filename ?? null}, ${body.mime ?? null}, ${rawText}, ${sql.json(extracted as any)}) returning *`
  return json({ ...doc, model }, 201)
})
