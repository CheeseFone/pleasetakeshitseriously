import exifr from 'exifr'

/** Photo capture time: EXIF DateTimeOriginal if present, else the file's modified time. */
export async function photoTime(file: File): Promise<{ time: Date; source: 'exif' | 'file' }> {
  try {
    const x = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'] })
    const d: Date | undefined = x?.DateTimeOriginal ?? x?.CreateDate ?? x?.DateTime
    if (d instanceof Date && !isNaN(+d)) return { time: d, source: 'exif' }
  } catch { /* no exif */ }
  return { time: new Date(file.lastModified || Date.now()), source: 'file' }
}
