/**
 * In-house email discovery for Edge (no subprocess).
 * Optional OSINT_WORKER_URL for theHarvester / heavier crawl.
 */

const EMAIL_RE =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi

const CRAWL_PATHS = [
  '/',
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/team',
  '/people',
  '/company',
  '/careers',
]

const COMMON_PATTERNS = [
  '{first}.{last}',
  '{f}{last}',
  '{first}{last}',
  '{first}_{last}',
  '{first}',
  '{f}.{last}',
]

export type EmailHit = {
  email: string
  source: 'site_crawl' | 'osint_worker'
  url?: string
}

export type OsintPersonResult = {
  email: string | null
  verification_status: string | null
  sources: string[]
  source_details: Record<string, unknown>
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '')
}

function inferPattern(emails: string[], domain: string): string | null {
  const d = domain.toLowerCase().replace(/^www\./, '')
  const votes = new Map<string, number>()
  for (const raw of emails) {
    const email = raw.toLowerCase().trim()
    if (!email.endsWith(`@${d}`)) continue
    const local = email.split('@')[0]
    const parts = local.split(/[._+\-]/)
    if (parts.length >= 2) {
      const first = parts[0]
      if (first.length === 1) {
        bump(votes, '{f}.{last}', 1)
        bump(votes, '{f}{last}', 1)
      }
      bump(votes, '{first}.{last}', 2)
      bump(votes, '{first}_{last}', 1)
      bump(votes, '{f}{last}', 1)
      bump(votes, '{first}{last}', 1)
    }
  }
  let best: string | null = null
  let bestN = 0
  for (const [p, n] of votes) {
    if (n > bestN) {
      bestN = n
      best = p
    }
  }
  return bestN >= 2 ? best : best
}

function bump(m: Map<string, number>, k: string, n: number) {
  m.set(k, (m.get(k) || 0) + n)
}

function applyPattern(pattern: string, first: string, last: string): string {
  const f = normName(first)
  const l = normName(last)
  const fLast = l[0] || ''
  return pattern
    .replace('{first}', f)
    .replace('{last}', l)
    .replace('{f}', f.slice(0, 1))
    .replace('{f_last}', fLast)
}

export function generateEmailCandidates(
  first: string,
  last: string,
  domain: string,
  pattern: string | null,
  limit = 8,
): string[] {
  const d = domain.toLowerCase().replace(/^www\./, '')
  const patterns = pattern ? [pattern, ...COMMON_PATTERNS] : [...COMMON_PATTERNS]
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of patterns) {
    if (out.length >= limit) break
    const local = applyPattern(p, first, last)
    if (!local) continue
    const email = `${local}@${d}`
    if (seen.has(email)) continue
    seen.add(email)
    out.push(email)
  }
  return out
}

function emailMatchesPerson(email: string, first: string, last: string): boolean {
  const local = normName(email.split('@')[0] || '')
  const f = normName(first)
  const l = normName(last)
  if (!f || !l) return false
  if (local === f + l || local === f + '.' + l || local === f + '_' + l) return true
  if (local === f[0] + l || local === f[0] + '.' + l) return true
  return local.includes(f) && local.includes(l)
}

export async function resolveMxHosts(mailDomain: string): Promise<string[]> {
  const name = mailDomain.toLowerCase().replace(/^www\./, '')
  const url =
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=MX`
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
    })
    if (!res.ok) return []
    const body = await res.json()
    const answers = (body.Answer || []) as Array<{
      type?: number
      data?: string
    }>
    return answers
      .filter((a) => a.type === 15 && a.data)
      .map((a) => String(a.data).split(/\s+/).pop() || '')
      .filter(Boolean)
  } catch {
    return []
  }
}

export async function verifyEmailMx(
  email: string,
): Promise<{ status: string; detail: Record<string, unknown> }> {
  const trimmed = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { status: 'invalid', detail: { reason: 'syntax' } }
  }
  const domain = trimmed.split('@')[1]
  const mx = await resolveMxHosts(domain)
  if (mx.length === 0) return { status: 'invalid', detail: { mx: 'none' } }
  return { status: 'mx_check', detail: { mx: mx.slice(0, 3) } }
}

export async function crawlSiteEmails(
  domain: string,
  opts?: { maxPages?: number; timeoutMs?: number },
): Promise<EmailHit[]> {
  const maxPages = opts?.maxPages ?? 10
  const timeoutMs = opts?.timeoutMs ?? 8000
  const host = domain.toLowerCase().replace(/^www\./, '')
  const base = `https://${host}`
  const seenUrls = new Set<string>()
  const emails = new Map<string, EmailHit>()
  const queue = CRAWL_PATHS.map((p) => `${base}${p}`)
  let pages = 0

  while (queue.length > 0 && pages < maxPages) {
    const url = queue.shift()!
    if (seenUrls.has(url)) continue
    seenUrls.add(url)
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'FollowUpEmailDiscovery/1.0 (+https://github.com)',
          Accept: 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      })
      clearTimeout(t)
      if (!res.ok) continue
      const html = await res.text()
      if (html.length > 2_000_000) continue
      pages += 1

      const mailtoRe = /href=["']mailto:([^"'?]+)/gi
      let m: RegExpExecArray | null
      while ((m = mailtoRe.exec(html)) !== null) {
        const addr = m[1].trim().toLowerCase()
        if (addr.includes('@')) {
          emails.set(addr, { email: addr, source: 'site_crawl', url })
        }
      }
      EMAIL_RE.lastIndex = 0
      while ((m = EMAIL_RE.exec(html)) !== null) {
        const addr = m[0].toLowerCase()
        if (addr.endsWith(`@${host}`)) {
          emails.set(addr, { email: addr, source: 'site_crawl', url })
        }
      }
      const linkRe = /href=["']([^"']+)["']/gi
      while ((m = linkRe.exec(html)) !== null) {
        const href = m[1]
        if (
          /contact|about|team|people|leadership/i.test(href) &&
          queue.length < 24
        ) {
          try {
            const next = new URL(href, url).toString()
            if (next.includes(host) && !seenUrls.has(next)) queue.push(next)
          } catch {
            // skip
          }
        }
      }
    } catch {
      // timeout / TLS / block
    }
  }

  return [...emails.values()]
}

export type OsintWorkerPerson = {
  first_name: string
  last_name: string
  email: string | null
  verification_status: string | null
  sources: string[]
  source_details: Record<string, unknown>
}

export async function fetchOsintWorker(
  domain: string,
  people: Array<{ first_name: string; last_name: string }>,
): Promise<{
  hits: EmailHit[]
  people: OsintWorkerPerson[]
  errors: string[]
}> {
  const base = Deno.env.get('OSINT_WORKER_URL')?.replace(/\/$/, '')
  if (!base) return { hits: [], people: [], errors: [] }
  const secret = Deno.env.get('OSINT_WORKER_SECRET')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (secret) headers.Authorization = `Bearer ${secret}`

  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 45_000)
    const res = await fetch(`${base}/v1/enrich`, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        domain,
        people,
        providers: ['site_crawl', 'harvester', 'pattern_mx'],
        smtp: false,
      }),
    })
    clearTimeout(t)
    const body = await res.json()
    if (!res.ok) {
      return {
        hits: [],
        people: [],
        errors: [body?.detail || `worker ${res.status}`],
      }
    }
    const hits = ((body.hits || []) as Array<{ email: string }>).map((h) => ({
      email: h.email.toLowerCase(),
      source: 'osint_worker' as const,
    }))
    const outPeople = (body.people || []) as OsintWorkerPerson[]
    return { hits, people: outPeople, errors: body.errors || [] }
  } catch (e) {
    return {
      hits: [],
      people: [],
      errors: [e instanceof Error ? e.message : 'worker failed'],
    }
  }
}

export type CompanyOsintBundle = {
  seedEmails: string[]
  hits: EmailHit[]
  workerPeople: OsintWorkerPerson[]
  pattern: string | null
  errors: string[]
}

export async function enrichCompanyOsint(
  domain: string,
  peopleForWorker: Array<{ first_name: string; last_name: string }>,
  opts?: { useWorker?: boolean },
): Promise<CompanyOsintBundle> {
  const errors: string[] = []
  const crawlHits = await crawlSiteEmails(domain)
  let workerHits: EmailHit[] = []
  let workerPeople: OsintWorkerPerson[] = []

  if (opts?.useWorker !== false && Deno.env.get('OSINT_WORKER_URL')) {
    const w = await fetchOsintWorker(domain, peopleForWorker)
    workerHits = w.hits
    workerPeople = w.people
    errors.push(...w.errors)
  }

  const hits = [...crawlHits]
  const seen = new Set(crawlHits.map((h) => h.email))
  for (const h of workerHits) {
    if (!seen.has(h.email)) {
      seen.add(h.email)
      hits.push(h)
    }
  }

  const seedEmails = [...seen]
  const pattern = inferPattern(seedEmails, domain)
  return { seedEmails, hits, workerPeople, pattern, errors }
}

export function findEmailForPersonOsint(
  domain: string,
  first: string,
  last: string,
  bundle: CompanyOsintBundle,
): OsintPersonResult | null {
  const sources: string[] = []
  const source_details: Record<string, unknown> = {}

  for (const hit of bundle.hits) {
    if (emailMatchesPerson(hit.email, first, last)) {
      sources.push(hit.source === 'site_crawl' ? 'site_crawl' : 'osint_worker')
      source_details[hit.source] = { email: hit.email, url: hit.url }
      return {
        email: hit.email,
        verification_status: 'public',
        sources: [...new Set(sources)],
        source_details,
      }
    }
  }

  const wp = bundle.workerPeople.find(
    (p) =>
      p.first_name?.toLowerCase() === first.toLowerCase() &&
      p.last_name?.toLowerCase() === last.toLowerCase() &&
      p.email,
  )
  if (wp?.email) {
    return {
      email: wp.email,
      verification_status: wp.verification_status || 'mx_check',
      sources: wp.sources?.length ? wp.sources : ['pattern', 'verify_mx'],
      source_details: { worker: wp.source_details },
    }
  }

  return null
}

export async function discoverPersonEmailOsint(
  domain: string,
  first: string,
  last: string,
  bundle: CompanyOsintBundle,
): Promise<OsintPersonResult> {
  const direct = findEmailForPersonOsint(domain, first, last, bundle)
  if (direct?.email) return direct

  const pattern = bundle.pattern
  const candidates = generateEmailCandidates(first, last, domain, pattern)
  for (const email of candidates) {
    const fin = await finalizeOsintEmail(email, bundle, first, last)
    const status = fin.verification_status
    if (!status || status === 'invalid') continue
    return {
      email,
      verification_status: status,
      sources: ['pattern', 'verify_mx'],
      source_details: {
        pattern: { inferred: pattern, candidates: candidates.slice(0, 5) },
        ...fin.source_details,
      },
    }
  }

  return {
    email: null,
    verification_status: null,
    sources: [],
    source_details: { pattern: { inferred: pattern } },
  }
}

export async function finalizeOsintEmail(
  email: string,
  bundle: CompanyOsintBundle,
  first: string,
  last: string,
): Promise<{ verification_status: string | null; source_details: Record<string, unknown> }> {
  const onSite = bundle.hits.some(
    (h) => h.email.toLowerCase() === email.toLowerCase(),
  )
  if (onSite) {
    return { verification_status: 'public', source_details: { via: 'company_site' } }
  }

  if (emailMatchesPerson(email, first, last) && bundle.pattern) {
    const mx = await verifyEmailMx(email)
    if (mx.status === 'mx_check') {
      const strongPattern = bundle.seedEmails.length >= 2 && bundle.pattern
      return {
        verification_status: strongPattern ? 'mx_likely' : 'mx_check',
        source_details: { verify: mx.detail, pattern: bundle.pattern },
      }
    }
    return { verification_status: 'invalid', source_details: { verify: mx.detail } }
  }

  const mx = await verifyEmailMx(email)
  if (mx.status === 'invalid') {
    return { verification_status: 'invalid', source_details: { verify: mx.detail } }
  }
  return { verification_status: 'mx_check', source_details: { verify: mx.detail } }
}

/** Statuses we accept when require_verified_email is on (non-Hunter). */
export function passesEmailVerification(
  status: string | null | undefined,
  requireVerified: boolean,
  acceptAcceptAll: boolean,
): boolean {
  if (!requireVerified) return true
  if (!status) return false
  const hunterOk = acceptAcceptAll
    ? ['valid', 'accept_all']
    : ['valid']
  const osintOk = acceptAcceptAll
    ? ['public', 'mx_likely', 'mx_check', 'valid', 'accept_all']
    : ['public', 'mx_likely', 'valid']
  return [...hunterOk, ...osintOk].includes(status)
}

export function isHunterQuotaResponse(
  status: number,
  body: unknown,
): boolean {
  if (status === 402 || status === 429) return true
  const err = body as {
    errors?: Array<{ id?: string; details?: string }>
  }
  const text = `${err?.errors?.[0]?.details || ''} ${err?.errors?.[0]?.id || ''}`
  return /credit|quota|limit|monthly|exceeded|too many/i.test(text)
}
