# Demo kit

Five synthetic residents on one unit. Each folder has the resident's seed data (`patient.json`), the
records you can drag into the app (`chart.md`, `mar.md`, `menu.md`) and, for two residents, stool
photos with EXIF dates for the bulk-upload demo. All names, charts and numbers are invented.
Stool photos come from the CC BY 4.0 "stool classification" dataset (smartgut, Roboflow Universe).

| Resident | Scenario | What the app shows |
|---|---|---|
| **Margaret Holt** 112-A | Constipation with an explanation in the record: low-fibre diet, fluids under target, chair-bound after a knee flare, amlodipine. | "Constipation pattern — likely explained by record" + "No BM for 3 days". Upload her 3 photos (types 2, 1, 1) to extend the pattern. |
| **Walter Brandt** 204-B | Loose stools that are *expected*: amoxicillin-clavulanate started 5 days ago for a UTI. Seeded log is all normal. | Before upload: "No BM recorded for 4 days". After uploading his 6 photos (types 6/7 over 4 days): "Loose stools — consistent with antibiotic", with C. diff and dehydration (CKD + metformin) watch-outs. |
| **Dorothy Kessler** 318-A | Constipation with *no* explanation on the MAR or diet. Clues are in the nursing notes: cold intolerance, weight gain, fatigue, TSH not checked for 14 months, daughter's calcium chews taken with the levothyroxine, meds moved to "with breakfast" in June. | "Constipation pattern — no documented explanation" with leads: check TSH, levothyroxine timing, reconcile OTC calcium. "Analyse record" should spell out the levothyroxine-absorption story. |
| **Eleanor Price** 221-A | Medication issue: full laxative regimen plus two PRN lactulose doses, now loose stools and incontinence. Cannot self-report (dementia). | "Loose stools — consistent with laxative" + incontinence; suggests holding/reviewing the regimen. |
| **Robert Tanaka** 110-B | Control: regular type 3–4 daily. | "Stable". The tool does not cry wolf. |

## Running the demo

1. Deploy (see `app/README.md`) or run locally with `npm run preview` inside `app/`.
2. Open **Settings → Load demo residents**. Entries are dated relative to *today* at seed time.
3. Re-stamp the photo EXIF dates so they end today (needs `pip install piexif pillow`):
   ```
   python3 demo/stamp_exif.py
   ```
   Copy `demo/patients/walter-brandt/photos` (and `margaret-holt/photos`) onto the demo device
   (AirDrop / Files on an iPad works; the EXIF dates survive).
4. Suggested flow (≈4 minutes):
   - **Dashboard**: status counts, sparkline of 14 days per resident, top finding. Click Robert: stable.
   - **Walter**: show normal log → **Log stool / bulk upload** → pick his 6 photos → each one classified
     on the device (note the mask outline, EXIF date, ~0.5 s) → Save → finding appears, explained by
     the antibiotic (drop box shows the MAR line that explains it).
   - **Dorothy**: same symptom, but "no documented explanation" → open **Analyse record** → AI points at
     TSH / levothyroxine + calcium timing. That's the "where to look" moment.
   - **Margaret**: dietary story; show the menu document and the "why" bullets.
   - **Settings**: models cached on device, thumbnails local only, privacy copy.
5. Drag a chart file into any resident's **Record drop box** to show live extraction (needs the
   OpenAI key). Taking a *photo* of a printed MAR works too (vision extraction).

## Notes

- Record documents mention fixed dates (Oct 11–17, 2026). If you demo much later, the seeded log
  (relative to today) and the document dates drift apart; edit the `.md` files or ignore it.
- Seeding wipes the database. `SEED_TOKEN` (optional env var) protects the endpoint once deployed.
