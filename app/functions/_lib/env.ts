export interface Env {
  DATABASE_URL: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  OPENAI_REASONING_EFFORT?: string
  SEED_TOKEN?: string
}
export type Ctx<P extends string = string> = EventContext<Env, P, unknown>

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } })

export class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

export const handle = <P extends string>(fn: (ctx: Ctx<P>) => Promise<Response>) => async (ctx: Ctx<P>) => {
  try { return await fn(ctx) } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 500
    console.error('API error', e?.message ?? e, e?.stack)
    return json({ error: e?.message ?? 'Internal error' }, status)
  } finally {
    const { closeDb } = await import('./db')
    closeDb(ctx as Ctx)
  }
}

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T } catch { throw new HttpError(400, 'Body must be JSON') }
}
