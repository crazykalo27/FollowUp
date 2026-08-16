/** Tomba.io email finder / domain search / verifier. Needs both key and secret. */

export type TombaRunState = {
  quotaExhausted: boolean
  quotaNote: string | null
}

export type TombaFinderResult = {
  email: string | null
  title: string | null
  linkedin_url: string | null
  location: string | null
  verification_status: string | null
  score: number | null
}

export type TombaDomainPerson = {
  first_name: string | null
  last_name: string | null
  full_name: string | null
  title: string | null
  email: string | null
  linkedin_url: string | null
  location: string | null
  verification_status: string | null
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    for (const k of ['name', 'title', 'value', 'country', 'city']) {
      if (typeof o[k] === 'string' && o[k].trim()) return o[k].trim()
    }
  }
  return null
}

function tombaApiKey(): string | undefined {
  return Deno.env.get('TOMBA_API_KEY')?.trim() || undefined
}

/** Prefer TOMBA_SECRET (the name Tomba's dashboard uses); TOMBA_API_SECRET also works. */
function tombaApiSecret(): string | undefined {
  return (
    Deno.env.get('TOMBA_SECRET')?.trim() ||
    Deno.env.get('TOMBA_API_SECRET')?.trim() ||
    undefined
  )
}

export function tombaConfigured(): boolean {
  return Boolean(tombaApiKey() && tombaApiSecret())
}

export function tombaAuthHeaders(): HeadersInit | null {
  const key = tombaApiKey()
  const secret = tombaApiSecret()
  if (!key || !secret) return null
  return {
    'X-Tomba-Key': key,
    'X-Tomba-Secret': secret,
  }
}

/** Map Tomba verification / result labels onto Hunter-compatible statuses. */
export function mapTombaVerificationStatus(
  status: string | null | undefined,
): string | null {
  if (!status) return null
  const s = status.toLowerCase().trim()
  if (
    s === 'valid' ||
    s === 'deliverable' ||
    s === 'verified'
  ) {
    return 'valid'
  }
  if (
    s === 'invalid' ||
    s === 'undeliverable' ||
    s === 'disposable' ||
    s === 'rejected'
  ) {
    return 'invalid'
  }
  if (
    s === 'accept_all' ||
    s === 'accept-all' ||
    s === 'catch_all' ||
    s === 'catch-all' ||
    s === 'catchall'
  ) {
    return 'accept_all'
  }
  if (s === 'risky' || s === 'unknown' || s === 'webmail') return s === 'webmail' ? 'unknown' : s
  return status
}

export function isTombaQuotaResponse(status: number, body: unknown): boolean {
  if (status === 429) return true
  const err = body as {
    errors?: { type?: string; message?: string; code?: number }
    message?: string
  }
  const text = `${err?.errors?.message || ''} ${err?.errors?.type || ''} ${err?.message || ''}`
  return /credit|quota|limit|exceeded|too many|rate.?limit/i.test(text)
}

async function tombaGet(
  path: string,
  params: Record<string, string>,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const headers = tombaAuthHeaders()
  if (!headers) {
    throw new Error('TOMBA_API_KEY and TOMBA_SECRET are not both configured')
  }

  const url = new URL(`https://api.tomba.io/v1/${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, body }
}

function verificationFromFinder(data: Record<string, unknown>): string | null {
  const verification = data.verification as
    | { status?: string }
    | undefined
  return mapTombaVerificationStatus(
    asString(verification?.status) ||
      asString(data.status) ||
      asString(data.result),
  )
}

/**
 * Email finder: most likely address for first + last + domain.
 * Consumes Tomba finder credits.
 */
export async function tombaEmailFinder(
  domain: string,
  first_name: string,
  last_name: string,
  state: TombaRunState,
  opts?: { company_name?: string | null },
): Promise<TombaFinderResult | null> {
  if (state.quotaExhausted || !tombaConfigured()) return null

  const params: Record<string, string> = {
    domain,
    first_name,
    last_name,
  }
  const company = opts?.company_name?.trim()
  if (company) params.company = company

  const { ok, status, body } = await tombaGet('email-finder', params, 10_000)
  if (isTombaQuotaResponse(status, body)) {
    state.quotaExhausted = true
    state.quotaNote = 'Tomba credits exhausted — using later email sources'
    return null
  }
  if (!ok) {
    const msg =
      asString((body.errors as { message?: string } | undefined)?.message) ||
      `Tomba ${status}`
    throw new Error(msg)
  }

  const data = (body.data || {}) as Record<string, unknown>
  const email = asString(data.email)
  if (!email && !asString(data.linkedin) && !asString(data.position)) return null

  return {
    email,
    title: asString(data.position),
    linkedin_url: asString(data.linkedin),
    location: asString(data.country),
    verification_status: verificationFromFinder(data),
    score: typeof data.score === 'number' ? data.score : null,
  }
}

/**
 * Domain search: up to 10 personal emails at a company (Tomba default / free cap).
 */
export async function tombaDomainSearch(
  domain: string,
  stats: { attempted: number; people_found: number; errors: string[] },
  state: TombaRunState,
  opts?: { company_name?: string | null },
): Promise<{ people: TombaDomainPerson[]; organization: string | null }> {
  stats.attempted += 1
  if (state.quotaExhausted || !tombaConfigured()) {
    return { people: [], organization: null }
  }

  try {
    const params: Record<string, string> = { domain, limit: '10' }
    const company = opts?.company_name?.trim()
    if (company) params.company = company

    const { ok, status, body } = await tombaGet('domain-search', params, 12_000)
    if (isTombaQuotaResponse(status, body)) {
      state.quotaExhausted = true
      state.quotaNote = 'Tomba credits exhausted — using later email sources'
      stats.errors.push(state.quotaNote)
      return { people: [], organization: null }
    }

    const data = (body.data || {}) as Record<string, unknown>
    const orgObj = (data.organization || {}) as Record<string, unknown>
    const organization = asString(orgObj.organization)
    const emails = Array.isArray(data.emails)
      ? (data.emails as Array<Record<string, unknown>>)
      : []

    if (!ok && emails.length === 0) {
      const msg =
        asString((body.errors as { message?: string } | undefined)?.message) ||
        `Tomba ${status}`
      stats.errors.push(msg)
      return { people: [], organization }
    }

    const people: TombaDomainPerson[] = []
    for (const p of emails.slice(0, 10)) {
      const type = asString(p.type)?.toLowerCase()
      if (type && type !== 'personal') continue
      const first = asString(p.first_name)
      const last = asString(p.last_name)
      const full = asString(p.full_name) || [first, last].filter(Boolean).join(' ')
      people.push({
        first_name: first,
        last_name: last,
        full_name: full || null,
        title: asString(p.position),
        email: asString(p.email),
        linkedin_url: asString(p.linkedin),
        location: asString(p.country),
        verification_status: verificationFromFinder(p),
      })
    }
    stats.people_found += people.length
    return { people, organization }
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : 'Tomba failed')
    return { people: [], organization: null }
  }
}

export async function tombaEmailVerifier(
  email: string,
  state: TombaRunState,
): Promise<string | null> {
  if (state.quotaExhausted || !tombaConfigured()) return null
  try {
    const { ok, status, body } = await tombaGet(
      'email-verifier',
      { email },
      10_000,
    )
    if (isTombaQuotaResponse(status, body)) {
      state.quotaExhausted = true
      state.quotaNote = 'Tomba credits exhausted — using later email sources'
      return null
    }
    if (!ok) return null
    const data = (body.data || {}) as Record<string, unknown>
    const emailObj = (data.email || data) as Record<string, unknown>
    if (emailObj.accept_all === true) return 'accept_all'
    return mapTombaVerificationStatus(
      asString(emailObj.status) || asString(emailObj.result),
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/credit|quota|limit|monthly|429/i.test(msg)) {
      state.quotaExhausted = true
      state.quotaNote = 'Tomba credits exhausted — using later email sources'
    }
    return null
  }
}
