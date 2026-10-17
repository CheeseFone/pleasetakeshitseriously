import postgres from 'postgres'
import type { Env, Ctx } from './env'

export type Sql = ReturnType<typeof postgres>

const perRequest = new WeakMap<object, Sql>()

// One short-lived connection per request (no Hyperdrive). Tiger Cloud is plain Postgres + TimescaleDB.
// `handle()` in env.ts calls closeDb() after the handler finishes.
export function db(ctx: Ctx): Sql {
  const existing = perRequest.get(ctx.request)
  if (existing) return existing
  const env = ctx.env as Env
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (add it to .dev.vars locally or as a Pages secret)')
  const sql = postgres(env.DATABASE_URL, {
    max: 1,
    ssl: 'require',
    fetch_types: false,
    prepare: false,
    idle_timeout: 5,
    connect_timeout: 15,
    // Timescale returns timestamptz; keep ISO strings end-to-end so the browser never re-parses in local zone.
    types: { timestamptz: { to: 1184, from: [1184], serialize: (v: string) => v, parse: (v: string) => new Date(v).toISOString() } },
  })
  perRequest.set(ctx.request, sql)
  return sql
}

// Postgres text[] literal (fetch_types is off, so sql.array() cannot infer the element type).
export const pgTextArray = (xs: readonly string[]) => '{' + xs.map(x => '"' + String(x).replace(/(["\\])/g, '\\$1') + '"').join(',') + '}'

export function closeDb(ctx: Ctx) {
  const sql = perRequest.get(ctx.request)
  if (!sql) return
  perRequest.delete(ctx.request)
  ctx.waitUntil(sql.end({ timeout: 2 }).catch(() => {}))
}

export const SCHEMA = `
create extension if not exists timescaledb;
create table if not exists patients (
  id text primary key,
  name text not null,
  room text,
  dob date,
  sex text,
  summary text,
  created_at timestamptz not null default now()
);
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  patient_id text not null references patients(id) on delete cascade,
  kind text not null,
  filename text,
  mime text,
  raw_text text,
  extracted jsonb,
  created_at timestamptz not null default now()
);
create index if not exists documents_patient_idx on documents(patient_id, created_at desc);
create table if not exists stool_entries (
  time timestamptz not null,
  id uuid not null default gen_random_uuid(),
  patient_id text not null references patients(id) on delete cascade,
  bristol_group smallint,
  bristol_type smallint,
  group_conf real,
  type_conf real,
  model_group smallint,
  model_type smallint,
  overridden boolean not null default false,
  flags text[] not null default '{}',
  note text,
  source text not null default 'manual',
  device_id text,
  created_at timestamptz not null default now(),
  primary key (patient_id, time, id)
);
select create_hypertable('stool_entries', 'time', if_not_exists => true);
create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  patient_id text not null references patients(id) on delete cascade,
  model text,
  risk_level text,
  headline text,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists analyses_patient_idx on analyses(patient_id, created_at desc);
`

export async function ensureSchema(sql: Sql) {
  // postgres.js `simple` mode runs multiple statements in one round-trip
  await sql.unsafe(SCHEMA)
}
