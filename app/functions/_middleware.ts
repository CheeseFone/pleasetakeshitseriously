// Optional site-wide password. Set SITE_PASSWORD in Cloudflare Pages (or .dev.vars) and every page,
// model file and API call asks the browser for HTTP Basic auth (any username, that password).
// Leave it unset and the site is open. Free on Cloudflare; no Zero Trust setup needed.
import type { Env } from './_lib/env'

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const want = ctx.env.SITE_PASSWORD
  if (!want) return ctx.next()
  const auth = ctx.request.headers.get('authorization') ?? ''
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const given = decoded.slice(decoded.indexOf(':') + 1)
      if (given.length === want.length && timingSafeEqual(given, want)) return ctx.next()
    } catch { /* fall through */ }
  }
  return new Response('Take Shit Seriously: enter the demo password (any username).', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="Take Shit Seriously", charset="UTF-8"', 'cache-control': 'no-store' },
  })
}

function timingSafeEqual(a: string, b: string) {
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
