import type { Env } from './env'
import { HttpError } from './env'
import type { ExtractedDoc, AnalysisResult, Patient, StoolEntry, PatientDocument, Finding, DocKind } from '../../shared/types'
import { FLAG_LABEL, GROUP_LABEL } from '../../shared/types'

const DEFAULT_MODEL = 'gpt-6-luna'

// ---------- JSON schemas (strict mode: every property required, nulls for optional) ----------
const medSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string' }, dose: { type: ['string', 'null'] }, frequency: { type: ['string', 'null'] },
    route: { type: ['string', 'null'] }, started: { type: ['string', 'null'], description: 'Start date or "new"/"recently added" if indicated' },
    indication: { type: ['string', 'null'] }, drug_class: { type: ['string', 'null'], description: 'e.g. antibiotic, opioid, laxative, diuretic, calcium supplement' },
    prn: { type: 'boolean' },
  },
  required: ['name', 'dose', 'frequency', 'route', 'started', 'indication', 'drug_class', 'prn'],
}
export const EXTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string', description: '1-2 sentence summary of what this document says, for a nurse' },
    transcribed_text: { type: ['string', 'null'], description: 'If the input was an image, a faithful transcription of its text; else null' },
    medications: { type: 'array', items: medSchema },
    diagnoses: { type: 'array', items: { type: 'string' } },
    allergies: { type: 'array', items: { type: 'string' } },
    diet: {
      type: 'object', additionalProperties: false,
      properties: {
        description: { type: ['string', 'null'] },
        fiber_level: { type: 'string', enum: ['low', 'moderate', 'high', 'unknown'] },
        fluid_intake: { type: 'string', enum: ['low', 'adequate', 'high', 'unknown'] },
        notes: { type: ['string', 'null'] },
      },
      required: ['description', 'fiber_level', 'fluid_intake', 'notes'],
    },
    mobility: { type: ['string', 'null'], description: 'Mobility / activity status if mentioned' },
    recent_changes: { type: 'array', items: { type: 'string' }, description: 'Anything new or changed recently: meds started/stopped, diet changes, symptoms, falls, hospital visits' },
    labs: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, value: { type: 'string' }, date: { type: ['string', 'null'] } }, required: ['name', 'value', 'date'] } },
  },
  required: ['summary', 'transcribed_text', 'medications', 'diagnoses', 'allergies', 'diet', 'mobility', 'recent_changes', 'labs'],
}

export const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    risk_level: { type: 'string', enum: ['low', 'moderate', 'high', 'urgent'] },
    headline: { type: 'string', description: 'One line, max 15 words, for the dashboard' },
    summary: { type: 'string', description: '3-5 sentences for the nurse: what is happening, whether it is expected, what to do' },
    observations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { observation: { type: 'string' }, expected: { type: 'boolean' }, reason: { type: 'string' } }, required: ['observation', 'expected', 'reason'] } },
    likely_causes: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { cause: { type: 'string' }, likelihood: { type: 'string', enum: ['high', 'moderate', 'low'] }, evidence: { type: 'string' } }, required: ['cause', 'likelihood', 'evidence'] } },
    recommended_actions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { action: { type: 'string' }, rationale: { type: 'string' }, urgency: { type: 'string', enum: ['now', 'today', 'this_week', 'routine'] } }, required: ['action', 'rationale', 'urgency'] } },
    questions_for_team: { type: 'array', items: { type: 'string' }, description: 'Specific things to check or ask that would confirm/refute the causes' },
    data_gaps: { type: 'array', items: { type: 'string' }, description: 'Missing records that would help (e.g. no MAR uploaded, no fluid intake record)' },
  },
  required: ['risk_level', 'headline', 'summary', 'observations', 'likely_causes', 'recommended_actions', 'questions_for_team', 'data_gaps'],
}

// ---------- low-level call ----------
type Content = { type: 'input_text'; text: string } | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' }

async function callStructured<T>(env: Env, system: string, user: Content[], schemaName: string, schema: object): Promise<{ data: T; model: string }> {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, 'OPENAI_API_KEY is not configured on the server')
  const model = env.OPENAI_MODEL || DEFAULT_MODEL
  const body: Record<string, unknown> = {
    model,
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
  }
  const effort = env.OPENAI_REASONING_EFFORT ?? 'low'
  if (effort !== 'none') body.reasoning = { effort }
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new HttpError(502, `OpenAI ${res.status}: ${txt.slice(0, 500)}`)
  }
  const out: any = await res.json()
  const msg = (out.output ?? []).find((o: any) => o.type === 'message')
  const part = msg?.content?.find((c: any) => c.type === 'output_text' || c.type === 'refusal')
  if (!part) throw new HttpError(502, 'OpenAI returned no message content')
  if (part.type === 'refusal') throw new HttpError(502, `OpenAI refused: ${part.refusal}`)
  return { data: JSON.parse(part.text) as T, model: out.model ?? model }
}

// ---------- document extraction ----------
export async function extractDocument(env: Env, args: { kind: DocKind; filename?: string; text?: string; imageDataUrl?: string }): Promise<{ extracted: ExtractedDoc; model: string }> {
  const system = `You are a clinical records assistant for a long-term-care nursing team. Extract structured facts from the supplied resident record.
Write in English only. Be literal: only report what the document states; use null/unknown/empty arrays when absent. Do not invent medications or diagnoses.
For diet documents (menus, intake sheets), judge fiber_level and fluid_intake from the foods and amounts listed (white bread/cream of wheat/mashed potato/no fruit or veg = low fibre; <1200 mL/day = low fluids).
Classify each medication's drug_class in plain terms (antibiotic, opioid, laxative, stool softener, diuretic, calcium supplement, iron supplement, antidepressant (SSRI), proton-pump inhibitor, calcium-channel blocker, thyroid hormone, etc).
List anything recently started, stopped, or changed under recent_changes, including new symptoms mentioned in notes.`
  const user: Content[] = [{ type: 'input_text', text: `Document kind: ${args.kind}${args.filename ? `\nFilename: ${args.filename}` : ''}` }]
  if (args.text) user.push({ type: 'input_text', text: `--- DOCUMENT TEXT ---\n${args.text.slice(0, 60_000)}` })
  if (args.imageDataUrl) user.push({ type: 'input_image', image_url: args.imageDataUrl, detail: 'high' })
  if (!args.text && !args.imageDataUrl) throw new HttpError(400, 'Nothing to extract')
  const { data, model } = await callStructured<ExtractedDoc>(env, system, user, 'resident_record', EXTRACT_SCHEMA)
  return { extracted: data, model }
}

// ---------- trend analysis ----------
export async function analyzePatient(env: Env, args: { patient: Patient; entries: StoolEntry[]; documents: PatientDocument[]; findings: Finding[]; now?: Date }): Promise<{ result: AnalysisResult; model: string }> {
  const now = args.now ?? new Date()
  const age = args.patient.dob ? Math.floor((+now - +new Date(args.patient.dob)) / (365.25 * 86_400_000)) : null
  const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ')
  const entries = [...args.entries].sort((a, b) => +new Date(a.time) - +new Date(b.time)).slice(-60)
  const entryLines = entries.map(e =>
    `${fmt(e.time)}  type ${e.bristol_type ?? '?'} (${e.bristol_group != null ? GROUP_LABEL[e.bristol_group] : '?'})${e.overridden ? ' [nurse override]' : ''}${e.flags.length ? '  flags: ' + e.flags.map(f => FLAG_LABEL[f] ?? f).join(', ') : ''}${e.note ? '  note: ' + e.note : ''}`,
  ).join('\n')
  const docLines = args.documents.map(d => {
    const x = d.extracted
    return `## ${d.kind.toUpperCase()}${d.filename ? ` (${d.filename})` : ''} — added ${fmt(d.created_at)}
${x ? `Summary: ${x.summary}
Diagnoses: ${x.diagnoses.join('; ') || 'none listed'}
Medications: ${x.medications.map(m => `${m.name}${m.dose ? ' ' + m.dose : ''}${m.frequency ? ' ' + m.frequency : ''}${m.prn ? ' PRN' : ''}${m.drug_class ? ' [' + m.drug_class + ']' : ''}${m.started ? ' started ' + m.started : ''}${m.indication ? ' for ' + m.indication : ''}`).join('; ') || 'none listed'}
Allergies: ${x.allergies.join('; ') || 'none listed'}
Diet: ${x.diet.description ?? 'n/a'} | fibre ${x.diet.fiber_level} | fluids ${x.diet.fluid_intake}${x.diet.notes ? ' | ' + x.diet.notes : ''}
Mobility: ${x.mobility ?? 'n/a'}
Recent changes: ${x.recent_changes.join('; ') || 'none'}
Labs: ${x.labs.map(l => `${l.name} ${l.value}${l.date ? ' (' + l.date + ')' : ''}`).join('; ') || 'none'}` : '(not yet extracted)'}${d.raw_text ? `\nRaw text (truncated):\n${d.raw_text.slice(0, 4000)}` : ''}`
  }).join('\n\n')
  const ruleLines = args.findings.map(f => `- [${f.severity}] ${f.title}: ${f.summary}\n  why: ${f.why.join(' / ')}`).join('\n')

  const system = `You are a clinical decision-support assistant for nurses in a long-term-care home, reviewing one resident's bowel-movement log (Bristol Stool Scale, recorded by CNAs from photos classified on-device) together with their chart, medication record and diet record.
Your job: decide whether the recent bowel pattern is EXPECTED given the record (e.g. loose stools while on an antibiotic, hard stools on opioids + low fibre) or UNEXPLAINED and deserving investigation, and give the care team concrete, prioritised next steps and the reasoning behind them.
Rules:
- Reason only from the supplied data. If something important is missing (no MAR, no intake record), say so under data_gaps instead of guessing.
- Be specific: name the medication, the date it started, the number of stools, the diet detail. Nurses want the "why".
- Think like a geriatric nurse practitioner: consider medication timing/interactions (e.g. calcium or iron taken with levothyroxine), dehydration, mobility, thyroid, electrolytes, infection (C. difficile with antibiotics/PPIs), laxative over-use, impaction with overflow, diet changes, and red flags (blood, fever, vomiting, severe pain, distension).
- Escalation thresholds: ≥3 loose stools/day, blood, fever, or diarrhoea > 48 h unexplained = urgent/high; no BM ≥ 5 days = high.
- Keep the headline under 15 words. Write for a busy nurse, in English only. No disclaimers inside the JSON; the app shows one.
- Today's date/time: ${now.toISOString()}.`
  const user: Content[] = [{ type: 'input_text', text: `# Resident
${args.patient.name}${age != null ? `, ${age} y` : ''}${args.patient.sex ? `, ${args.patient.sex}` : ''}${args.patient.room ? `, room ${args.patient.room}` : ''}
${args.patient.summary ?? ''}

# Rule-engine findings (deterministic, already shown to the nurse — refine, confirm or challenge them)
${ruleLines || '- none'}

# Bowel log (oldest first, last ${entries.length} entries; times UTC)
${entryLines || '(no entries)'}

# Records on file
${docLines || '(no documents uploaded)'}` }]
  const { data, model } = await callStructured<AnalysisResult>(env, system, user, 'bowel_trend_analysis', ANALYSIS_SCHEMA)
  return { result: data, model }
}
