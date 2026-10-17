// Bundles ../demo/patients/*/ (patient.json + record text files) into functions/_lib/demo-data.json,
// which the POST /api/admin/seed endpoint loads. Run after editing anything in demo/.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const demoRoot = new URL('../../demo/patients/', import.meta.url).pathname
const out = []
for (const dir of readdirSync(demoRoot).sort()) {
  const pj = join(demoRoot, dir, 'patient.json')
  if (!existsSync(pj)) continue
  const p = JSON.parse(readFileSync(pj, 'utf8'))
  p.docs = p.docs.map(d => ({ ...d, text: readFileSync(join(demoRoot, dir, d.file), 'utf8') }))
  out.push(p)
}
const target = new URL('../functions/_lib/demo-data.json', import.meta.url).pathname
writeFileSync(target, JSON.stringify(out))
console.log(`wrote ${out.length} demo patients to functions/_lib/demo-data.json`)
