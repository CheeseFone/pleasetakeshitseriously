// Extracts text from a PDF in the browser (pdf.js). The PDF itself never leaves the device; only its text does.
export async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    parts.push(content.items.map((it: any) => ('str' in it ? it.str : '')).join(' '))
  }
  return parts.join('\n\n').replace(/[ \t]+/g, ' ').trim()
}

/** Downscale an image file to a JPEG data URL (max side `max`) for sending a chart photo to the extractor. */
export async function imageToDataUrl(file: File, max = 1600, quality = 0.85): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return c.toDataURL('image/jpeg', quality)
}
