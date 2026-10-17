// On-device stool classification with onnxruntime-web. Photos are processed here and never uploaded.
import * as ort from 'onnxruntime-web/wasm'
import type { BristolGroup } from '../../shared/types'
import { GROUP_OF_TYPE } from '../../shared/types'

ort.env.wasm.wasmPaths = '/ort/'

const MODELS = { group: '/models/stool_3group_v4.onnx', type: '/models/stool_v4.onnx' } as const
const CACHE = 'tss-models-v2'   // bump when the model files change so cached copies are replaced
export const INPUT = 640
const SCORE_THR = 0.2      // both models under-detect rather than over-detect
const TYPE_MIN = 0.6       // only show an exact type when the 7-class model is confident

export interface Detection { x1: number; y1: number; x2: number; y2: number; score: number; cls: number; coeffs: Float32Array }
export interface ClassifyResult {
  group: BristolGroup | null; groupConf: number | null
  type: number | null; typeConf: number | null            // policy-filtered type (1..7)
  typeRaw: number | null; typeRawConf: number | null      // top 7-class detection regardless of policy
  overlay: HTMLCanvasElement                              // 640x640 RGBA mask overlay (stretched coordinates)
  thumb: string                                           // data URL: photo + overlay, max 360 px
  width: number; height: number; ms: number
}

async function fetchCached(url: string, onProgress?: (msg: string) => void): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(url)
    if (hit) { onProgress?.(`Loaded ${url.split('/').pop()} from device cache`); return hit.arrayBuffer() }
    onProgress?.(`Downloading ${url.split('/').pop()} (one time, ~11 MB)…`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
    await cache.put(url, res.clone())
    return res.arrayBuffer()
  } catch {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
    return res.arrayBuffer()
  }
}

type Sessions = { group: ort.InferenceSession; type: ort.InferenceSession }
let sessions: Promise<Sessions> | null = null

export function loadModels(onProgress?: (msg: string) => void): Promise<Sessions> {
  if (!sessions) {
    sessions = (async () => {
      const [g, t] = await Promise.all([fetchCached(MODELS.group, onProgress), fetchCached(MODELS.type, onProgress)])
      onProgress?.('Initialising on-device runtime…')
      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
      const group = await ort.InferenceSession.create(g, opts)
      const type = await ort.InferenceSession.create(t, opts)
      onProgress?.('Models ready')
      return { group, type }
    })().catch(e => { sessions = null; throw e })
  }
  return sessions
}

export async function modelsCached(): Promise<boolean> {
  try { const c = await caches.open(CACHE); return !!(await c.match(MODELS.group)) && !!(await c.match(MODELS.type)) } catch { return false }
}

async function toBitmap(src: Blob): Promise<ImageBitmap> {
  try { return await createImageBitmap(src, { imageOrientation: 'from-image' } as any) } catch { return createImageBitmap(src) }
}

function preprocess(bmp: ImageBitmap): { tensor: ort.Tensor; canvas: HTMLCanvasElement } {
  const c = document.createElement('canvas')
  c.width = INPUT; c.height = INPUT
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, INPUT, INPUT) // stretch, matching training-time letterbox-free policy
  const { data } = ctx.getImageData(0, 0, INPUT, INPUT)
  const n = INPUT * INPUT
  const f = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) { f[i] = data[i * 4] / 255; f[n + i] = data[i * 4 + 1] / 255; f[2 * n + i] = data[i * 4 + 2] / 255 }
  return { tensor: new ort.Tensor('float32', f, [1, 3, INPUT, INPUT]), canvas: c }
}

function parse(out: ort.Tensor): Detection[] {
  const d = out.data as Float32Array
  const [, rows, cols] = out.dims
  const dets: Detection[] = []
  for (let i = 0; i < rows; i++) {
    const o = i * cols
    const score = d[o + 4]
    if (score <= SCORE_THR) continue
    dets.push({ x1: d[o], y1: d[o + 1], x2: d[o + 2], y2: d[o + 3], score, cls: d[o + 5], coeffs: d.slice(o + 6, o + cols) })
  }
  return dets.sort((a, b) => b.score - a.score)
}

/** sigmoid(coeffs · protos) cropped to the box → 160×160 alpha mask drawn into a 640×640 overlay canvas. */
export function drawMask(det: Detection, protos: ort.Tensor, overlay: HTMLCanvasElement, rgb: [number, number, number], alpha = 120) {
  const p = protos.data as Float32Array
  const [, k, h, w] = protos.dims // 32, 160, 160
  const n = h * w
  const m = new Float32Array(n)
  for (let j = 0; j < k; j++) { const c = det.coeffs[j]; const off = j * n; for (let i = 0; i < n; i++) m[i] += c * p[off + i] }
  const s = w / INPUT
  const bx1 = Math.max(0, Math.floor(det.x1 * s)), by1 = Math.max(0, Math.floor(det.y1 * s))
  const bx2 = Math.min(w, Math.ceil(det.x2 * s)), by2 = Math.min(h, Math.ceil(det.y2 * s))
  const img = new ImageData(w, h)
  for (let y = by1; y < by2; y++) for (let x = bx1; x < bx2; x++) {
    const i = y * w + x
    if (1 / (1 + Math.exp(-m[i])) > 0.5) { const o = i * 4; img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = alpha }
  }
  const small = document.createElement('canvas'); small.width = w; small.height = h
  small.getContext('2d')!.putImageData(img, 0, 0)
  const ctx = overlay.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(small, 0, 0, INPUT, INPUT)
  ctx.strokeStyle = `rgb(${rgb.join(',')})`; ctx.lineWidth = 3
  ctx.strokeRect(det.x1, det.y1, det.x2 - det.x1, det.y2 - det.y1)
}

export const GROUP_RGB: Record<number, [number, number, number]> = { 0: [180, 83, 9], 1: [21, 128, 61], 2: [194, 65, 12] }
export const TYPE_RGB = (t: number): [number, number, number] => GROUP_RGB[GROUP_OF_TYPE(t)]

/** Full inspection for the playground: every detection from both models, timings, and an annotated canvas. */
export interface Inspection {
  width: number; height: number
  groupDets: Detection[]; typeDets: Detection[]
  groupProtos: ort.Tensor; typeProtos: ort.Tensor
  timings: { decode: number; preprocess: number; group: number; type: number; total: number }
  policy: { group: BristolGroup | null; groupConf: number | null; type: number | null; typeConf: number | null; typeRaw: number | null; typeRawConf: number | null; reason: string }
  draw: (opts: { model: 'group' | 'type'; masks: boolean; boxes: boolean; all: boolean; maxSide?: number }) => HTMLCanvasElement
}

export async function inspect(src: Blob, onProgress?: (msg: string) => void): Promise<Inspection> {
  const { group, type } = await loadModels(onProgress)
  const t0 = performance.now()
  const bmp = await toBitmap(src)
  const t1 = performance.now()
  const { tensor, canvas } = preprocess(bmp)
  const t2 = performance.now()
  const gOut = await group.run({ images: tensor })
  const t3 = performance.now()
  const tOut = await type.run({ images: tensor })
  const t4 = performance.now()
  const groupDets = parse(gOut.output0), typeDets = parse(tOut.output0)
  const top = groupDets[0], tTop = typeDets[0]
  const g: BristolGroup | null = top ? (Math.round(top.cls) as BristolGroup) : null
  const typeRaw = tTop ? Math.round(tTop.cls) + 1 : null
  const typeRawConf = tTop ? tTop.score : null
  let typ: number | null = null, typeConf: number | null = null, reason = ''
  if (!top) reason = 'No stool detected by the 3-group model (all scores ≤ 0.2).'
  else if (!tTop) reason = `Group from the 3-group model. The 7-type model found nothing above 0.2, so no exact type is shown.`
  else if (typeRawConf! < TYPE_MIN) reason = `Group from the 3-group model. The 7-type model's best guess (type ${typeRaw}, ${Math.round(typeRawConf! * 100)}%) is below the 60% bar, so only the group is shown.`
  else if (GROUP_OF_TYPE(typeRaw!) !== g) reason = `Group from the 3-group model. The 7-type model says type ${typeRaw} (${Math.round(typeRawConf! * 100)}%) but that belongs to a different group, so the models disagree and only the group is shown.`
  else { typ = typeRaw; typeConf = typeRawConf; reason = `Both models agree: type ${typeRaw} sits inside the ${GROUP_LABEL_LOCAL[g!]} group and scores ≥ 60%, so the exact type is shown.` }
  // keep the bitmap for drawing (closed when the page unmounts via GC)
  const draw: Inspection['draw'] = ({ model, masks, boxes, all, maxSide = 900 }) => {
    const dets = model === 'group' ? groupDets : typeDets
    const protos = model === 'group' ? gOut.output1 : tOut.output1
    const overlay = document.createElement('canvas'); overlay.width = INPUT; overlay.height = INPUT
    const list = all ? dets.slice(0, 5) : dets.slice(0, 1)
    for (const d of [...list].reverse()) {
      const cls = Math.round(d.cls)
      const rgb = model === 'group' ? GROUP_RGB[cls] : TYPE_RGB(cls + 1)
      if (masks) drawMask(d, protos, overlay, rgb, 110)
    }
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    if (masks) ctx.drawImage(overlay, 0, 0, c.width, c.height)
    const sx = c.width / INPUT, sy = c.height / INPUT
    for (const d of list) {
      const cls = Math.round(d.cls)
      const rgb = model === 'group' ? GROUP_RGB[cls] : TYPE_RGB(cls + 1)
      const label = `${model === 'group' ? GROUP_LABEL_LOCAL[cls as BristolGroup] : 'Type ' + (cls + 1)} ${Math.round(d.score * 100)}%`
      const x = d.x1 * sx, y = d.y1 * sy, w = (d.x2 - d.x1) * sx, h = (d.y2 - d.y1) * sy
      if (boxes) { ctx.lineWidth = 3; ctx.strokeStyle = `rgb(${rgb.join(',')})`; ctx.strokeRect(x, y, w, h) }
      ctx.font = `600 ${Math.max(12, Math.round(c.width / 40))}px system-ui, sans-serif`
      const tw = ctx.measureText(label).width + 10, th = Math.max(18, Math.round(c.width / 28))
      ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(x, Math.max(0, y - th), tw, th)
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 5, Math.max(0, y - th) + th / 2)
    }
    return c
  }
  canvas.width = 0
  return {
    width: bmp.width, height: bmp.height, groupDets, typeDets, groupProtos: gOut.output1, typeProtos: tOut.output1,
    timings: { decode: t1 - t0, preprocess: t2 - t1, group: t3 - t2, type: t4 - t3, total: t4 - t0 },
    policy: { group: g, groupConf: top?.score ?? null, type: typ, typeConf, typeRaw, typeRawConf, reason },
    draw,
  }
}
const GROUP_LABEL_LOCAL: Record<BristolGroup, string> = { 0: 'Constipated', 1: 'Normal', 2: 'Loose' }

export async function classify(src: Blob, onProgress?: (msg: string) => void): Promise<ClassifyResult> {
  const { group, type } = await loadModels(onProgress)
  const t0 = performance.now()
  const bmp = await toBitmap(src)
  const { tensor, canvas } = preprocess(bmp)
  const [gOut, tOut] = await Promise.all([group.run({ images: tensor }), type.run({ images: tensor })])
  const gDets = parse(gOut.output0), tDets = parse(tOut.output0)
  const overlay = document.createElement('canvas'); overlay.width = INPUT; overlay.height = INPUT

  const top = gDets[0]
  const g: BristolGroup | null = top ? (Math.round(top.cls) as BristolGroup) : null
  if (top) drawMask(top, gOut.output1, overlay, GROUP_RGB[g!])

  const tTop = tDets[0]
  const typeRaw = tTop ? Math.round(tTop.cls) + 1 : null
  const typeRawConf = tTop ? tTop.score : null
  let typ: number | null = null, typeConf: number | null = null
  if (tTop && typeRaw && typeRawConf! >= TYPE_MIN && g != null && GROUP_OF_TYPE(typeRaw) === g) { typ = typeRaw; typeConf = typeRawConf }

  // thumbnail at original aspect ratio with the overlay mapped back
  const max = 360, scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const tc = document.createElement('canvas'); tc.width = Math.round(bmp.width * scale); tc.height = Math.round(bmp.height * scale)
  const tctx = tc.getContext('2d')!
  tctx.drawImage(bmp, 0, 0, tc.width, tc.height)
  tctx.drawImage(overlay, 0, 0, tc.width, tc.height)
  const thumb = tc.toDataURL('image/jpeg', 0.8)
  const res: ClassifyResult = { group: g, groupConf: top?.score ?? null, type: typ, typeConf, typeRaw, typeRawConf, overlay, thumb, width: bmp.width, height: bmp.height, ms: Math.round(performance.now() - t0) }
  bmp.close(); canvas.width = 0
  return res
}
