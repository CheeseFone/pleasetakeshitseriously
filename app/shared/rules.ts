// Explainable rules engine. Pure function: (entries, documents, now) -> findings.
// Every finding carries a `why` chain so the UI can show the evidence, not just the flag.
import type {
  Finding, Severity, StoolEntry, PatientDocument, PatientStatus, Medication, ExtractedDoc,
} from './types'
import { SEVERITY_RANK } from './types'

const DAY = 86_400_000

// Drug-class heuristics. Matching is on lower-cased name OR drug_class text from the extraction.
const CONSTIPATING: [RegExp, string][] = [
  [/opioid|morphine|oxycodone|hydrocodone|codeine|tramadol|fentanyl|hydromorphone|tapentadol/, 'opioid'],
  [/anticholinergic|oxybutynin|tolterodine|solifenacin|benztropine|hyoscyamine|dicyclomine/, 'anticholinergic'],
  [/\biron\b|ferrous/, 'iron supplement'],
  [/verapamil|diltiazem|amlodipine|nifedipine|calcium[- ]channel/, 'calcium-channel blocker'],
  [/calcium (carbonate|citrate|acetate|chew|supplement)|\bcalcium\b|\btums\b/, 'calcium supplement'],
  [/aluminum hydroxide|sucralfate/, 'aluminum antacid'],
  [/ondansetron|zofran/, 'ondansetron (5-HT3 antagonist)'],
  [/amitriptyline|nortriptyline|tricyclic/, 'tricyclic antidepressant'],
  [/clozapine|olanzapine|quetiapine|risperidone|haloperidol|antipsychotic/, 'antipsychotic'],
  [/loperamide|imodium|diphenoxylate/, 'antidiarrheal'],
  [/cholestyramine|colestipol/, 'bile-acid binder'],
  [/levodopa|carbidopa|ropinirole|pramipexole/, 'antiparkinsonian'],
  [/gabapentin|pregabalin/, 'gabapentinoid'],
]
// Contributors: raise the suspicion but do not by themselves "explain" a new constipation pattern.
const CONTRIBUTING: [RegExp, string][] = [
  [/furosemide|lasix|hydrochlorothiazide|bumetanide|torsemide|diuretic/, 'diuretic (dehydration risk)'],
]
const LOOSENING: [RegExp, string][] = [
  [/amoxicillin|clavulanate|augmentin|cephalexin|ceftriaxone|cefuroxime|cefdinir|ciprofloxacin|levofloxacin|clindamycin|azithromycin|doxycycline|nitrofurantoin|sulfamethoxazole|trimethoprim|bactrim|metronidazole|vancomycin|piperacillin|antibiotic/, 'antibiotic'],
  [/senna|sennosides|bisacodyl|dulcolax|polyethylene glycol|miralax|peg 3350|lactulose|docusate|magnesium hydroxide|milk of magnesia|magnesium citrate|lubiprostone|linaclotide|laxative|stool softener/, 'laxative / bowel regimen'],
  [/metformin/, 'metformin'],
  [/colchicine/, 'colchicine'],
  [/magnesium oxide|magnesium/, 'magnesium supplement'],
  [/donepezil|rivastigmine|galantamine|cholinesterase/, 'cholinesterase inhibitor'],
  [/sertraline|fluoxetine|citalopram|escitalopram|paroxetine|ssri/, 'SSRI'],
  [/orlistat|acarbose|misoprostol|mycophenolate/, 'GI-active drug'],
  [/proton pump|omeprazole|pantoprazole|esomeprazole|lansoprazole/, 'proton-pump inhibitor (C. diff risk)'],
]

function medMatches(meds: Medication[], table: [RegExp, string][]): { med: Medication; cls: string }[] {
  const out: { med: Medication; cls: string }[] = []
  for (const m of meds) {
    const hay = `${m.name} ${m.drug_class ?? ''}`.toLowerCase()
    for (const [re, cls] of table) if (re.test(hay)) { out.push({ med: m, cls }); break }
  }
  return out
}

function allMeds(docs: PatientDocument[]): Medication[] {
  const seen = new Map<string, Medication>()
  for (const d of docs) for (const m of d.extracted?.medications ?? []) {
    const k = m.name.toLowerCase().trim()
    if (!seen.has(k)) seen.set(k, m)
  }
  return [...seen.values()]
}

function mergedDiet(docs: PatientDocument[]): ExtractedDoc['diet'] | null {
  const diets = docs.map(d => d.extracted?.diet).filter(Boolean) as ExtractedDoc['diet'][]
  if (!diets.length) return null
  const pick = <T extends string>(vals: T[], unknown: T) => vals.find(v => v !== unknown) ?? unknown
  return {
    description: diets.map(d => d.description).filter(Boolean).join('; ') || null,
    fiber_level: pick(diets.map(d => d.fiber_level), 'unknown'),
    fluid_intake: pick(diets.map(d => d.fluid_intake), 'unknown'),
    notes: diets.map(d => d.notes).filter(Boolean).join('; ') || null,
  }
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
const medLabel = (m: Medication) => m.name + (m.started ? ` (${/^\d/.test(m.started) ? 'started ' : ''}${m.started})` : '')

export function evaluate(entriesIn: StoolEntry[], docs: PatientDocument[], now: Date = new Date()): Finding[] {
  const entries = [...entriesIn].sort((a, b) => +new Date(a.time) - +new Date(b.time))
  const findings: Finding[] = []
  const meds = allMeds(docs)
  const diet = mergedDiet(docs)
  const mobility = docs.map(d => d.extracted?.mobility).find(Boolean) ?? null
  const changes = docs.flatMap(d => d.extracted?.recent_changes ?? [])
  const diagnoses = docs.flatMap(d => d.extracted?.diagnoses ?? [])
  const dx = diagnoses.join(' | ').toLowerCase()
  const t = +now
  const within = (days: number) => entries.filter(e => t - +new Date(e.time) <= days * DAY && +new Date(e.time) <= t + DAY)
  const last7 = within(7), last3 = within(3), last14 = within(14)
  const constipating = medMatches(meds, CONSTIPATING)
  const contributing = medMatches(meds, CONTRIBUTING)
  const loosening = medMatches(meds, LOOSENING)
  const antibiotics = loosening.filter(x => x.cls === 'antibiotic')
  const laxatives = loosening.filter(x => x.cls === 'laxative / bowel regimen')
  const ppi = loosening.filter(x => x.cls.startsWith('proton-pump'))

  // R1 — blood or persistent mucus
  const blood = last7.filter(e => e.flags.includes('blood'))
  if (blood.length) {
    findings.push({
      id: 'blood', severity: 'urgent', title: 'Blood reported in stool', expected: null,
      summary: `Blood flagged on ${blood.length} entr${blood.length === 1 ? 'y' : 'ies'} in the last 7 days (latest ${fmtDay(blood[blood.length - 1].time)}).`,
      why: [
        `[Log] Nurse flagged "blood" on ${blood.map(e => fmtDay(e.time)).join(', ')}.`,
        blood.some(e => (e.bristol_type ?? 4) <= 2) ? '[Log] Hard stools present — could be anal fissure / haemorrhoid from straining, but must be assessed.' : '[Log] Occurs with non-hard stools — infectious or inflammatory cause needs ruling out.',
      ],
      suggested: ['Notify provider today.', 'Document colour/amount (bright red vs dark/tarry).', 'Check vitals and for abdominal pain, fever, anticoagulant use.'],
    })
  }

  // R2 — no bowel movement for 3+ days (only if the record is being kept, i.e. something in last 14d)
  if (entries.length && last14.length) {
    const last = entries[entries.length - 1]
    const gapDays = Math.floor((t - +new Date(last.time)) / DAY)
    if (gapDays >= 3) {
      findings.push({
        id: 'no_bm', severity: gapDays >= 5 ? 'high' : 'watch', title: `No bowel movement recorded for ${gapDays} days`, expected: null,
        summary: `Last recorded BM was ${fmtDay(last.time)}${last.bristol_type ? ` (type ${last.bristol_type})` : ''}.`,
        why: [
          `[Log] Gap since last entry: ${gapDays} days (threshold 3).`,
          ...(last.bristol_group === 0 ? ['[Log] The last stool was already hard (type 1–2) — gap plus hard stool points to constipation, not just missed charting.'] : []),
          ...(constipating.length ? [`[MAR] On constipating medication: ${constipating.map(c => `${c.med.name} (${c.cls})`).join(', ')}.`] : []),
        ],
        suggested: ['Confirm with the resident/CNA that no BM was missed in charting.', 'Assess abdomen for distension, discomfort; check for overflow leakage.', gapDays >= 5 ? 'Escalate per bowel protocol (impaction risk).' : 'Apply bowel protocol (fluids, fibre, mobility, PRN softener) and recheck tomorrow.'],
      })
    }
  }

  // R3 — constipation pattern
  const hard7 = last7.filter(e => e.bristol_group === 0)
  if (last7.length >= 3 && hard7.length >= 3 && hard7.length / last7.length >= 0.5) {
    const straining = last7.filter(e => e.flags.includes('straining') || e.flags.includes('pain')).length
    const lowFluidFlags = last7.filter(e => e.flags.includes('low_fluids')).length
    const missedMeals = last7.filter(e => e.flags.includes('missed_meal')).length
    const why: string[] = [`[Log] ${hard7.length} of the last ${last7.length} stools were type 1–2 (hard / lumpy).`]
    const causes: string[] = []
    if (straining) why.push(`[Log] Straining or abdominal pain flagged on ${straining} entr${straining === 1 ? 'y' : 'ies'}.`)
    if (constipating.length) { why.push(`[MAR] Constipating medication on record: ${constipating.map(c => `${medLabel(c.med)} — ${c.cls}`).join('; ')}.`); causes.push('medication') }
    if (contributing.length) why.push(`[MAR] Contributing medication: ${contributing.map(c => `${c.med.name} — ${c.cls}`).join('; ')}.`)
    if (diet?.fiber_level === 'low') { why.push(`[Diet] Diet record indicates low fibre${diet.description ? ` (${diet.description})` : ''}.`); causes.push('diet') }
    if (diet?.fluid_intake === 'low' || lowFluidFlags >= 2) { why.push(`[Log] Low fluid intake${lowFluidFlags ? ` flagged ${lowFluidFlags}×` : ''}${diet?.fluid_intake === 'low' ? ', also documented in the diet record' : ''}.`); causes.push('fluids') }
    if (missedMeals >= 2) why.push(`[Log] Missed meals flagged ${missedMeals}× in 7 days.`)
    if (mobility && /chair-?bound|bed-?bound|bed ?rest|wheelchair|limited|reduced|declin|immobil|non-?ambulatory|(one|two|1|2)[- ]assist/i.test(mobility)) { why.push(`[Chart] Reduced mobility documented: "${mobility}".`); causes.push('mobility') }
    // Leads: conditions that can cause constipation but do not by themselves explain a NEW pattern.
    const leads: string[] = []
    if (/hypothyroid/.test(dx)) { why.push('[Chart] Hypothyroidism on problem list — under-replacement causes constipation; check whether levothyroxine is absorbed (empty stomach, 4 h from calcium/iron) and when TSH was last checked.'); leads.push('Check TSH and levothyroxine administration timing.') }
    if (/parkinson/.test(dx)) { why.push('[Chart] Parkinson disease on problem list (slows gut motility).'); leads.push('Review Parkinson medication timing and dose.') }
    if (/diabet/.test(dx)) { why.push('[Chart] Diabetes on problem list (autonomic neuropathy can slow transit).'); leads.push('Check glucose control.') }
    const newSupplement = changes.find(c => /calcium|iron|supplement|over-the-counter|otc|not on (the )?mar/i.test(c))
    if (newSupplement) { why.push(`[Chart] Recent change on record: "${newSupplement}" — calcium and iron are constipating and block levothyroxine absorption.`); leads.push('Reconcile over-the-counter supplements with the MAR and separate them from levothyroxine by 4 h.') }
    const explained = causes.length > 0
    const severity: Severity = straining >= 2 || (!explained && hard7.length >= 4) ? 'high' : 'watch'
    findings.push({
      id: 'constipation', severity, expected: explained,
      title: explained ? 'Constipation pattern — likely explained by record' : 'Constipation pattern — no documented explanation',
      summary: explained
        ? `Hard stools over the last week; record suggests ${causes.join(' + ')} as contributing factor${causes.length > 1 ? 's' : ''}.`
        : `Hard stools over the last week with no constipating medication, low-fibre diet or mobility change on file.${leads.length ? ' The record holds leads worth following.' : ' Worth investigating.'}`,
      why,
      suggested: explained
        ? [
            ...(causes.includes('medication') ? ['Review constipating medications with the prescriber (dose, alternatives, add a scheduled softener/laxative).'] : []),
            ...(causes.includes('diet') ? ['Dietitian referral: add fibre (prunes, bran, fruit/veg) within the resident\'s preferences.'] : []),
            ...(causes.includes('fluids') ? ['Fluid plan: offer fluids each round; target per care plan.'] : []),
            ...(causes.includes('mobility') ? ['Increase mobilisation / PT review.'] : []),
            ...leads,
            'Track response over the next 3–5 days.',
          ]
        : [
            ...leads,
            'Ask: any new medication, supplement or OTC product not on the MAR?',
            'Check hydration and intake records; look for dehydration (diuretics, poor intake, fever).',
            'Consider labs: TSH, calcium, electrolytes, glucose.',
            'Assess for pain on defecation, haemorrhoids, impaction, new neurological change.',
            'Provider review if persistent >1 week or any red flag (vomiting, distension, blood, weight loss).',
          ],
    })
  }

  // R4 — loose / diarrhoea pattern
  const loose3 = last3.filter(e => e.bristol_group === 2)
  const loose7 = last7.filter(e => e.bristol_group === 2)
  const perDay = new Map<string, number>()
  for (const e of loose3) { const d = e.time.slice(0, 10); perDay.set(d, (perDay.get(d) ?? 0) + 1) }
  const maxPerDay = Math.max(0, ...perDay.values())
  if (loose3.length >= 2 || loose7.length >= 3) {
    const why: string[] = [`[Log] ${loose3.length} loose stool${loose3.length === 1 ? '' : 's'} (type 6–7) in the last 3 days, ${loose7.length} in the last 7.`]
    if (maxPerDay >= 3) why.push(`[Log] ${maxPerDay} loose stools in one day — meets the ≥3/day threshold used for C. difficile testing.`)
    const causes: string[] = []
    if (antibiotics.length) { why.push(`[MAR] Antibiotic on record: ${antibiotics.map(a => medLabel(a.med)).join(', ')} — antibiotic-associated diarrhoea is common and usually self-limiting.`); causes.push('antibiotic') }
    if (laxatives.length) { why.push(`[MAR] Bowel regimen in place: ${laxatives.map(a => medLabel(a.med)).join(', ')} — possible over-treatment.`); causes.push('laxative') }
    const otherLoosening = loosening.filter(x => !['antibiotic', 'laxative / bowel regimen'].includes(x.cls) && !x.cls.startsWith('proton-pump'))
    if (otherLoosening.length) { why.push(`[MAR] Other medication that can loosen stool: ${otherLoosening.map(a => `${a.med.name} (${a.cls})`).join(', ')}.`); causes.push('medication') }
    if (ppi.length) why.push(`[MAR] On a proton-pump inhibitor (${ppi.map(p => p.med.name).join(', ')}) — raises C. difficile risk if an infection is being considered.`)
    const dietChange = changes.find(c => /diet|supplement|feed|lactose|dairy|sweetener/i.test(c))
    if (dietChange) { why.push(`[Chart] Recent change on record: "${dietChange}".`); causes.push('diet change') }
    const nv = last7.filter(e => e.flags.includes('nausea_vomiting')).length
    const pain = last7.filter(e => e.flags.includes('pain')).length
    const lowFluid = last7.filter(e => e.flags.includes('low_fluids')).length
    if (nv) why.push(`[Log] Nausea/vomiting flagged ${nv}× — raises concern for infectious cause.`)
    if (pain) why.push(`[Log] Abdominal pain flagged ${pain}×.`)
    if (lowFluid) why.push(`[Log] Low fluid intake flagged ${lowFluid}× — dehydration risk alongside fluid loss.`)
    const explained = causes.length > 0
    let severity: Severity = 'watch'
    if (!explained || maxPerDay >= 3 || nv || blood.length) severity = 'high'
    if (lowFluid && loose3.length >= 3) severity = 'high'
    const ckd = /ckd|kidney|renal/.test(dx)
    findings.push({
      id: 'diarrhoea', severity, expected: explained,
      title: explained ? `Loose stools — consistent with ${causes.join(' / ')}` : 'Loose stools — no documented explanation',
      summary: explained
        ? `Expected given the record, but monitor: escalate if ≥3/day, fever, blood, severe pain, or it persists beyond the course.`
        : 'New loose stools without an antibiotic, laxative or diet change on file. Infection or a new medication should be ruled out.',
      why,
      suggested: [
        ...(causes.includes('antibiotic') ? ['Expected course: should settle within days of finishing the antibiotic. Encourage fluids; consider holding PRN laxatives.', 'If ≥3 loose stools/day, fever, or abdominal pain: contact provider and send stool for C. difficile per protocol; apply contact precautions meanwhile.'] : []),
        ...(causes.includes('laxative') ? ['Review bowel regimen with prescriber — hold or reduce scheduled laxatives and reassess in 48 h.'] : []),
        ...(!explained ? ['Check for fever, new meds/supplements, recent dietary change, sick contacts on the unit.', 'Contact precautions and stool testing (C. difficile, culture) per infection-control protocol.', 'Provider review today.'] : []),
        'Push oral fluids; monitor intake/output, skin integrity, and orthostatic symptoms.',
        ...(ckd ? ['Kidney disease on file: dehydration raises AKI and drug-accumulation risk (e.g. metformin) — low threshold to check renal function.'] : []),
      ],
    })
  }

  // R5 — shift from baseline (mean Bristol type of last 3 entries vs the 4–14-day window before)
  const recent = last3.filter(e => e.bristol_type != null)
  const base = entries.filter(e => { const age = t - +new Date(e.time); return age > 3 * DAY && age <= 14 * DAY && e.bristol_type != null })
  if (recent.length >= 2 && base.length >= 3) {
    const mean = (xs: StoolEntry[]) => xs.reduce((s, e) => s + (e.bristol_type as number), 0) / xs.length
    const mr = mean(recent), mb = mean(base)
    if (Math.abs(mr - mb) >= 2 && !findings.some(f => f.id === 'constipation' || f.id === 'diarrhoea')) {
      findings.push({
        id: 'baseline_shift', severity: 'watch', expected: null, title: 'Change from this resident\'s usual pattern',
        summary: `Average Bristol type moved from ${mb.toFixed(1)} (previous 2 weeks) to ${mr.toFixed(1)} (last 3 days).`,
        why: [`[Log] Baseline: ${base.length} entries averaging type ${mb.toFixed(1)}.`, `[Log] Recent: ${recent.length} entries averaging type ${mr.toFixed(1)}.`, 'A shift of 2 or more types is outside normal day-to-day variation.'],
        suggested: ['Review for new medication, intake change or illness in the last few days.', 'Continue daily charting to confirm whether the change persists.'],
      })
    }
  }

  // R6 — intake concern
  const missed = last3.filter(e => e.flags.includes('missed_meal')).length + last3.filter(e => e.flags.includes('low_fluids')).length
  if (missed >= 2) {
    findings.push({
      id: 'intake', severity: 'watch', expected: null, title: 'Reduced intake flagged',
      summary: `Missed meals / low fluids flagged ${missed}× in the last 3 days.`,
      why: ['[Log] CNA flags on bowel entries indicate poor intake.', 'Poor intake precedes dehydration, constipation, confusion and falls.'],
      suggested: ['Cross-check meal and fluid intake records.', 'Offer preferred foods/fluids; consider dietitian review.'],
    })
  }

  // R7 — sustained incontinence (new)
  const inc7 = last7.filter(e => e.flags.includes('incontinence')).length
  if (inc7 >= 3) {
    findings.push({
      id: 'incontinence', severity: 'watch', expected: null, title: 'Faecal incontinence recurring',
      summary: `Incontinence flagged on ${inc7} entries in 7 days.`,
      why: ['[Log] Repeated incontinence with loose stool suggests urgency/diarrhoea; with hard stool it can be overflow from impaction.'],
      suggested: ['Check for impaction if stools are hard or absent.', 'Skin care and toileting schedule.'],
    })
  }

  // info — nothing to flag
  if (!findings.length && last14.length) {
    findings.push({
      id: 'stable', severity: 'info', expected: null, title: 'No bowel concerns detected',
      summary: `${last7.length} entr${last7.length === 1 ? 'y' : 'ies'} in the last 7 days, within the normal range.`,
      why: [last7.length ? `[Log] Types recorded: ${last7.map(e => e.bristol_type ?? '?').join(', ')}.` : 'No entries in the last 7 days.'],
      suggested: [],
    })
  }

  return findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

export function statusOf(findings: Finding[], entryCount: number): PatientStatus {
  if (!entryCount) return 'nodata'
  const top = findings[0]
  if (!top || top.severity === 'info') return 'stable'
  return top.severity
}
