# Take Shit Seriously — app

Vite + React + TypeScript front end, Cloudflare Pages Functions back end, Tiger Cloud (TimescaleDB)
for trends, OpenAI for record extraction and trend analysis. Stool photos never leave the device:
two ONNX models run in the browser with onnxruntime-web.

```
app/
  src/                 React UI (pages: Dashboard, PatientPage, CapturePage, SettingsPage)
    lib/model.ts       on-device YOLO26n-seg inference, mask overlay, Cache-API model caching
    lib/exif.ts        EXIF DateTimeOriginal -> entry time (bulk upload)
    lib/idb.ts         thumbnails in IndexedDB (device-local only)
    lib/pdf.ts         PDF -> text in the browser (pdf.js); chart photo -> downscaled JPEG
  shared/
    types.ts           types shared by browser and server
    rules.ts           explainable rules engine (findings with "why" + next steps)
  functions/           Cloudflare Pages Functions (= the API)
    api/patients/...   roster, detail, entries, documents, analyze
    api/admin/seed.ts  wipe + load demo residents
    _lib/db.ts         postgres.js connection + schema (hypertable on stool_entries)
    _lib/openai.ts     Responses API calls with strict JSON schemas
    _lib/demo-data.json  generated from ../demo by scripts/build-demo.mjs
  public/models/       stool_3group_v4.onnx, stool_v4.onnx (copied from ../models)
  scripts/             copy-ort.mjs (wasm runtime into public/ort), build-demo.mjs
```

## Local run

```bash
cd app
npm install
cp .dev.vars.example .dev.vars      # fill DATABASE_URL and OPENAI_API_KEY
npm run preview                     # builds, then serves UI + API on http://localhost:8788
```
Then open http://localhost:8788/settings and click **Load demo residents** (creates the tables too).

For UI iteration: terminal 1 `npm run api` (serves the last build + functions on 8788), terminal 2
`npm run dev` (Vite on 5173, proxies /api to 8788).

## Deploy to Cloudflare Pages

1. Push the repo to GitHub. In Cloudflare → Workers & Pages → Create → Pages → connect the repo.
2. Build settings: **Root directory** `app`, **Build command** `npm run build`, **Output** `dist`.
   (`wrangler.toml` supplies `nodejs_compat`; `.node-version` pins Node 22.)
3. Settings → Variables and Secrets (Production):
   - `DATABASE_URL` (secret) — the Tiger Cloud service URL, with `?sslmode=require`
   - `OPENAI_API_KEY` (secret)
   - `OPENAI_MODEL` (optional, default `gpt-6-luna`; `gpt-5.4-mini` and `gpt-5-nano` also work)
   - `OPENAI_REASONING_EFFORT` (optional: `low` default, `none` to omit the reasoning parameter)
   - `SEED_TOKEN` (optional) — protects `POST /api/admin/seed`
4. Deploy, open `/settings`, load the demo residents.

Limits that matter: Pages serves files up to 25 MB (the models are 11 MB each, the wasm runtime 14 MB);
Functions requests are capped at 100 MB, we cap chart photos at ~6 MB after downscaling.

## API

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/health` | db, timescaledb version, whether the OpenAI key is set |
| GET | `/api/patients` | roster with status, last BM, 14-day types, top finding |
| POST | `/api/patients` | `{name, room?, dob?, sex?, summary?}` |
| GET | `/api/patients/:id` | patient, entries (90 d), documents, findings, latest analysis, daily buckets |
| POST | `/api/patients/:id/entries` | `{entries:[{id?, time, bristol_group, bristol_type, group_conf, type_conf, model_group, model_type, overridden, flags[], note, source, device_id}]}` |
| PATCH/DELETE | `/api/patients/:id/entries/:entryId` | |
| POST | `/api/patients/:id/documents` | `{kind, filename?, text?}` or `{kind, image_data_url}` → extracted with OpenAI, stored (image discarded) |
| DELETE | `/api/patients/:id/documents/:docId` | |
| POST | `/api/patients/:id/analyze` | runs rules + OpenAI, stores and returns the analysis |
| POST | `/api/admin/seed` | header `x-seed-token` if `SEED_TOKEN` is set |

## Model contract (browser)

Input `images` float32 `[1,3,640,640]` RGB /255, photo stretched. Output0 `[1,300,38]` rows =
`x1,y1,x2,y2,score,class,32 mask coeffs`; output1 `[1,32,160,160]` protos. Keep `score > 0.2`.
Headline = top detection of `stool_3group_v4` (0 constipated, 1 normal, 2 loose). Exact type = top
detection of `stool_v4` only if score ≥ 0.6 and the type sits inside the headline group.
Mask = `sigmoid(coeffs · protos) > 0.5` cropped to the box.
