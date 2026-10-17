// Copies the onnxruntime-web wasm runtime next to the site so the model runs from our own origin.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
const dist = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).pathname
const out = new URL('../public/ort/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
let n = 0
for (const f of readdirSync(dist)) {
  if (/^ort-wasm-simd-threaded\.(wasm|mjs)$/.test(f)) { cpSync(join(dist, f), join(out, f)); n++ }
}
console.log(`copied ${n} onnxruntime-web files to public/ort/`)
