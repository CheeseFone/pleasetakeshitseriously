// Types shared by the browser (src/) and the Cloudflare Pages Functions (functions/).

export type BristolGroup = 0 | 1 | 2 // 0 constipated (types 1-2), 1 normal (3-5), 2 loose (6-7)
export const GROUP_LABEL: Record<BristolGroup, string> = { 0: 'Constipated', 1: 'Normal', 2: 'Loose' }
export const GROUP_OF_TYPE = (t: number): BristolGroup => (t <= 2 ? 0 : t <= 5 ? 1 : 2)

export const ENTRY_FLAGS = [
  'blood', 'mucus', 'straining', 'pain', 'missed_meal', 'low_fluids', 'incontinence', 'nausea_vomiting',
] as const
export type EntryFlag = (typeof ENTRY_FLAGS)[number]
export const FLAG_LABEL: Record<EntryFlag, string> = {
  blood: 'Blood', mucus: 'Mucus', straining: 'Straining', pain: 'Abdominal pain', missed_meal: 'Missed meal',
  low_fluids: 'Low fluids', incontinence: 'Incontinence', nausea_vomiting: 'Nausea / vomiting',
}

export interface Patient {
  id: string
  name: string
  room: string | null
  dob: string | null // YYYY-MM-DD
  sex: string | null
  summary: string | null
  created_at?: string
}

export interface StoolEntry {
  id: string
  patient_id: string
  time: string // ISO
  bristol_group: BristolGroup | null
  bristol_type: number | null // 1..7
  group_conf: number | null
  type_conf: number | null
  model_group: BristolGroup | null
  model_type: number | null
  overridden: boolean
  flags: EntryFlag[]
  note: string | null
  source: 'camera' | 'bulk' | 'manual' | 'seed'
  device_id: string | null
}

export type DocKind = 'chart' | 'mar' | 'menu' | 'note' | 'lab' | 'other'
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  chart: 'Chart / history', mar: 'MAR / prescriptions', menu: 'Diet / menu', note: 'Nursing note', lab: 'Labs / vitals', other: 'Other',
}

export interface Medication {
  name: string
  dose: string | null
  frequency: string | null
  route: string | null
  started: string | null // free text date
  indication: string | null
  drug_class: string | null
  prn: boolean
}

export interface ExtractedDoc {
  summary: string
  transcribed_text: string | null
  medications: Medication[]
  diagnoses: string[]
  allergies: string[]
  diet: {
    description: string | null
    fiber_level: 'low' | 'moderate' | 'high' | 'unknown'
    fluid_intake: 'low' | 'adequate' | 'high' | 'unknown'
    notes: string | null
  }
  mobility: string | null
  recent_changes: string[]
  labs: { name: string; value: string; date: string | null }[]
}

export interface PatientDocument {
  id: string
  patient_id: string
  kind: DocKind
  filename: string | null
  mime: string | null
  raw_text: string | null
  extracted: ExtractedDoc | null
  created_at: string
}

export type Severity = 'urgent' | 'high' | 'watch' | 'info'
export const SEVERITY_RANK: Record<Severity, number> = { urgent: 3, high: 2, watch: 1, info: 0 }

export interface Finding {
  id: string
  severity: Severity
  title: string
  summary: string
  why: string[] // the evidence chain, in plain language
  expected: boolean | null // true = explained by the record, false = unexplained, null = n/a
  suggested: string[]
}

export type PatientStatus = 'urgent' | 'high' | 'watch' | 'stable' | 'nodata'

export interface Analysis {
  id: string
  patient_id: string
  model: string
  risk_level: 'low' | 'moderate' | 'high' | 'urgent'
  headline: string
  result: AnalysisResult
  created_at: string
}

export interface AnalysisResult {
  risk_level: 'low' | 'moderate' | 'high' | 'urgent'
  headline: string
  summary: string
  observations: { observation: string; expected: boolean; reason: string }[]
  likely_causes: { cause: string; likelihood: 'high' | 'moderate' | 'low'; evidence: string }[]
  recommended_actions: { action: string; rationale: string; urgency: 'now' | 'today' | 'this_week' | 'routine' }[]
  questions_for_team: string[]
  data_gaps: string[]
}

export interface PatientRosterRow extends Patient {
  status: PatientStatus
  top_finding: string | null
  top_expected: boolean | null
  last_bm: string | null
  entry_count_7d: number
  recent_types: (number | null)[] // last 14 days, oldest first, one per entry
}

export interface PatientDetail {
  patient: Patient
  entries: StoolEntry[]
  documents: PatientDocument[]
  findings: Finding[]
  status: PatientStatus
  analysis: Analysis | null
  daily: { day: string; n: number; avg_type: number | null; loose: number; hard: number }[]
}
