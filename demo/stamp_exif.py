#!/usr/bin/env python3
"""Write EXIF DateTimeOriginal into the demo stool photos, relative to a demo date.

The app reads each photo's EXIF date during bulk upload, so the photos must look like they were
taken over the last few days. Re-run this before a demo:

    python3 demo/stamp_exif.py                # dates end today
    python3 demo/stamp_exif.py --end 2026-10-25

Offsets (day/time per photo) come from each patient.json "photos" list.
Requires: pip install piexif pillow
"""
import argparse, datetime as dt, json, pathlib, sys
try:
    import piexif
    from PIL import Image
except ImportError:
    sys.exit("pip install piexif pillow")

root = pathlib.Path(__file__).resolve().parent
ap = argparse.ArgumentParser()
ap.add_argument('--end', default=dt.date.today().isoformat(), help='date that counts as day 0 (YYYY-MM-DD)')
args = ap.parse_args()
end = dt.date.fromisoformat(args.end)

n = 0
for pj in sorted((root / 'patients').glob('*/patient.json')):
    p = json.loads(pj.read_text())
    for ph in p.get('photos', []):
        path = pj.parent / ph['file']
        when = dt.datetime.combine(end + dt.timedelta(days=ph['day']), dt.time.fromisoformat(ph['time']))
        stamp = when.strftime('%Y:%m:%d %H:%M:%S')
        img = Image.open(path)
        exif = {'0th': {piexif.ImageIFD.Make: b'Apple', piexif.ImageIFD.Model: b'iPad (10th generation)',
                        piexif.ImageIFD.DateTime: stamp.encode(), piexif.ImageIFD.Software: b'18.6'},
                'Exif': {piexif.ExifIFD.DateTimeOriginal: stamp.encode(), piexif.ExifIFD.DateTimeDigitized: stamp.encode(),
                         piexif.ExifIFD.PixelXDimension: img.width, piexif.ExifIFD.PixelYDimension: img.height},
                '1st': {}, 'thumbnail': None}
        piexif.insert(piexif.dump(exif), str(path))
        print(f'{path.relative_to(root)}  ->  {stamp}  (expect type {ph.get("expect_type", "?")})')
        n += 1
print(f'{n} photos stamped, day 0 = {end}')
