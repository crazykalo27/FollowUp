/**
 * In-house email discovery for Edge (no subprocess).
 * Optional OSINT_WORKER_URL for theHarvester / heavier crawl.
 */

const DEFAULT_FETCH_MS = 6_000
const DNS_FETCH_MS = 4_000
const WORKER_FETCH_MS = 12_000
const OSINT_BUDGET_MS = 20_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function readTextWithLimit(
  res: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const buf = await res.arrayBuffer()
    if (buf.byteLength > maxBytes) return ''
    return new TextDecoder().decode(buf)
  } catch {
    return ''
  } finally {
    clearTimeout(t)
  }
}

const EMAIL_RE =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/gi

/** Inboxes we never attach to contacts during people search (job boards / aggregators). */
const BLOCKED_OUTREACH_EMAIL_DOMAINS = new Set(['dice.com'])

export function outreachEmailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.lastIndexOf('@')
  if (at < 1) return null
  return trimmed.slice(at + 1).replace(/^www\./, '')
}

export function isBlockedOutreachEmail(
  email: string | null | undefined,
): boolean {
  if (!email?.trim()) return false
  const domain = outreachEmailDomain(email)
  if (!domain) return false
  return BLOCKED_OUTREACH_EMAIL_DOMAINS.has(domain)
}

/** Drop blocked domains; normalize to lowercase when kept. */
export function sanitizeOutreachEmail(
  email: string | null | undefined,
): string | null {
  if (!email?.trim()) return null
  const normalized = email.trim().toLowerCase()
  return isBlockedOutreachEmail(normalized) ? null : normalized
}

function filterEmailHits(hits: EmailHit[]): EmailHit[] {
  return hits.filter((h) => !isBlockedOutreachEmail(h.email))
}

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
  source: 'site_crawl' | 'osint_worker' | 'web_snippet'
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
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/dns-json' } },
      DNS_FETCH_MS,
    )
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
      const res = await fetchWithTimeout(
        url,
        {
          headers: {
            'User-Agent': 'FollowUpEmailDiscovery/1.0 (+https://github.com)',
            Accept: 'text/html,application/xhtml+xml',
          },
          redirect: 'follow',
        },
        timeoutMs,
      )
      if (!res.ok) continue
      const html = await readTextWithLimit(res, 1_500_000, Math.min(timeoutMs, 6000))
      if (!html) continue
      pages += 1

      const mailtoRe = /href=["']mailto:([^"'?]+)/gi
      let m: RegExpExecArray | null
      while ((m = mailtoRe.exec(html)) !== null) {
        const addr = m[1].trim().toLowerCase()
        if (addr.includes('@') && !isBlockedOutreachEmail(addr)) {
          emails.set(addr, { email: addr, source: 'site_crawl', url })
        }
      }
      EMAIL_RE.lastIndex = 0
      while ((m = EMAIL_RE.exec(html)) !== null) {
        const addr = m[0].toLowerCase()
        if (addr.endsWith(`@${host}`) && !isBlockedOutreachEmail(addr)) {
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
    const res = await fetchWithTimeout(
      `${base}/v1/enrich`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          domain,
          people,
          providers: ['site_crawl', 'harvester', 'pattern_mx'],
          smtp: false,
        }),
      },
      WORKER_FETCH_MS,
    )
    const body = await res.json()
    if (!res.ok) {
      return {
        hits: [],
        people: [],
        errors: [body?.detail || `worker ${res.status}`],
      }
    }
    const hits = ((body.hits || []) as Array<{ email: string }>)
      .map((h) => ({
        email: h.email.toLowerCase(),
        source: 'osint_worker' as const,
      }))
      .filter((h) => !isBlockedOutreachEmail(h.email))
    const outPeople = ((body.people || []) as OsintWorkerPerson[]).map((p) => ({
      ...p,
      email: sanitizeOutreachEmail(p.email),
    }))
    return { hits, people: outPeople, errors: body.errors || [] }
  } catch (e) {
    return {
      hits: [],
      people: [],
      errors: [e instanceof Error ? e.message : 'worker failed'],
    }
  }
}

function extractEmailsFromText(text: string, domain: string): string[] {
  const host = domain.toLowerCase().replace(/^www\./, '')
  const found = new Set<string>()
  EMAIL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = EMAIL_RE.exec(text)) !== null) {
    const em = m[0].toLowerCase()
    if (em.endsWith(`@${host}`) && !isBlockedOutreachEmail(em)) found.add(em)
  }
  return [...found]
}

/** Prefer Bing (free tier) over Serper — one query per company max. */
async function runLightWebSearch(
  q: string,
  num: number,
): Promise<Array<{ snippet?: string; title?: string }>> {
  const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
  const serperKey = Deno.env.get('SERPER_API_KEY')
  if (!bingKey && !serperKey) return []

  if (bingKey) {
    const url = new URL('https://api.bing.microsoft.com/v7.0/search')
    url.searchParams.set('q', q)
    url.searchParams.set('count', String(num))
    const res = await fetchWithTimeout(
      url.toString(),
      { headers: { 'Ocp-Apim-Subscription-Key': bingKey } },
      DEFAULT_FETCH_MS,
    )
    const body = await res.json()
    if (!res.ok) return []
    return (body.webPages?.value || []).map(
      (v: { snippet?: string; name?: string }) => ({
        snippet: v.snippet,
        title: v.name,
      }),
    )
  }

  const res = await fetchWithTimeout(
    'https://google.serper.dev/search',
    {
      method: 'POST',
      headers: {
        'X-API-KEY': serperKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num }),
    },
    DEFAULT_FETCH_MS,
  )
  const body = await res.json()
  if (!res.ok) return []
  return (body.organic || []).map((o: { snippet?: string; title?: string }) => ({
    snippet: o.snippet,
    title: o.title,
  }))
}

/** Single search API call — emails from result snippets only (no extra fetches). */
export async function discoverEmailsFromSearchSnippets(
  domain: string,
): Promise<EmailHit[]> {
  const host = domain.toLowerCase().replace(/^www\./, '')
  const q = `"@${host}"`
  const rows = await runLightWebSearch(q, 5)
  const hits = new Map<string, EmailHit>()
  for (const row of rows) {
    const text = `${row.title || ''} ${row.snippet || ''}`
    for (const em of extractEmailsFromText(text, host)) {
      if (isBlockedOutreachEmail(em)) continue
      hits.set(em, { email: em, source: 'web_snippet' })
    }
  }
  return [...hits.values()]
}

async function fetchSitemapContactUrls(
  domain: string,
  limit = 3,
): Promise<string[]> {
  const host = domain.toLowerCase().replace(/^www\./, '')
  const base = `https://${host}`
  const urls: string[] = []
  try {
    const res = await fetchWithTimeout(
      `${base}/sitemap.xml`,
      {
        headers: { 'User-Agent': 'FollowUpEmailDiscovery/1.0' },
      },
      5000,
    )
    if (!res.ok) return urls
    const xml = await res.text()
    const locRe = /<loc>([^<]+)<\/loc>/gi
    let m: RegExpExecArray | null
    while ((m = locRe.exec(xml)) !== null && urls.length < limit) {
      const loc = m[1]
      if (/contact|about|team|people|leadership/i.test(loc)) urls.push(loc)
    }
  } catch {
    // ignore
  }
  return urls
}

export async function crawlSitemapHintPages(
  domain: string,
): Promise<EmailHit[]> {
  const extraUrls = await fetchSitemapContactUrls(domain, 3)
  if (extraUrls.length === 0) return []
  const host = domain.toLowerCase().replace(/^www\./, '')
  const hits = new Map<string, EmailHit>()
  for (const url of extraUrls) {
    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { 'User-Agent': 'FollowUpEmailDiscovery/1.0' } },
        5000,
      )
      if (!res.ok) continue
      const html = await readTextWithLimit(res, 800_000, 5000)
      if (!html) continue
      for (const em of extractEmailsFromText(html, host)) {
        hits.set(em, { email: em, source: 'site_crawl', url })
      }
    } catch {
      // skip
    }
  }
  return [...hits.values()]
}

export type CompanyOsintBundle = {
  seedEmails: string[]
  hits: EmailHit[]
  workerPeople: OsintWorkerPerson[]
  pattern: string | null
  errors: string[]
  mxStatusCache: Map<string, string>
}

async function verifyEmailMxCached(
  email: string,
  cache: Map<string, string>,
): Promise<{ status: string; detail: Record<string, unknown> }> {
  const key = email.toLowerCase()
  if (cache.has(key)) {
    return { status: cache.get(key)!, detail: { cached: true } }
  }
  const mx = await verifyEmailMx(email)
  cache.set(key, mx.status)
  return mx
}

export async function enrichCompanyOsint(
  domain: string,
  peopleForWorker: Array<{ first_name: string; last_name: string }>,
  opts?: {
    useWorker?: boolean
    fast?: boolean
    emailWebSearch?: boolean
    budgetMs?: number
  },
): Promise<CompanyOsintBundle> {
  const errors: string[] = []
  const mxStatusCache = new Map<string, string>()
  const started = Date.now()
  const budgetMs = opts?.budgetMs ?? OSINT_BUDGET_MS
  const timeLeft = () => budgetMs - (Date.now() - started)

  const emptyBundle = (): CompanyOsintBundle => ({
    seedEmails: [],
    hits: [],
    workerPeople: [],
    pattern: null,
    errors,
    mxStatusCache,
  })

  if (timeLeft() < 1500) {
    errors.push('osint skipped — time budget')
    return emptyBundle()
  }

  const fast = opts?.fast === true
  let crawlHits: EmailHit[] = []
  try {
    crawlHits = filterEmailHits(
      await crawlSiteEmails(domain, {
      maxPages: fast ? 3 : 5,
      timeoutMs: fast ? 3500 : 4500,
    }),
    )
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'site_crawl failed')
  }

  let sitemapHits: EmailHit[] = []
  if (!fast && timeLeft() > 4000) {
    try {
      sitemapHits = filterEmailHits(await crawlSitemapHintPages(domain))
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'sitemap crawl failed')
    }
  }

  let snippetHits: EmailHit[] = []
  if (!fast && opts?.emailWebSearch !== false && timeLeft() > 3500) {
    try {
      snippetHits = filterEmailHits(
        await discoverEmailsFromSearchSnippets(domain),
      )
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'web_snippet search failed')
    }
  }

  let workerHits: EmailHit[] = []
  let workerPeople: OsintWorkerPerson[] = []

  if (
    !fast &&
    opts?.useWorker !== false &&
    Deno.env.get('OSINT_WORKER_URL') &&
    timeLeft() > 8000
  ) {
    const w = await fetchOsintWorker(domain, peopleForWorker.slice(0, 8))
    workerHits = filterEmailHits(w.hits)
    workerPeople = w.people
    errors.push(...w.errors)
  }

  const hits = [...crawlHits, ...sitemapHits]
  const seen = new Set(hits.map((h) => h.email))
  for (const h of snippetHits) {
    if (!seen.has(h.email)) {
      seen.add(h.email)
      hits.push(h)
    }
  }
  for (const h of workerHits) {
    if (!seen.has(h.email)) {
      seen.add(h.email)
      hits.push(h)
    }
  }

  const seedEmails = [...seen]
  const pattern = inferPattern(seedEmails, domain)
  if (timeLeft() < 0) {
    errors.push('osint finished over budget')
  }
  return { seedEmails, hits, workerPeople, pattern, errors, mxStatusCache }
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
    if (isBlockedOutreachEmail(hit.email)) continue
    if (emailMatchesPerson(hit.email, first, last)) {
      sources.push(
        hit.source === 'site_crawl'
          ? 'site_crawl'
          : hit.source === 'web_snippet'
            ? 'web_snippet'
            : 'osint_worker',
      )
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
  if (wp?.email && !isBlockedOutreachEmail(wp.email)) {
    const email = sanitizeOutreachEmail(wp.email)
    if (!email) return null
    return {
      email,
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
  const candidates = generateEmailCandidates(first, last, domain, pattern, 3)
  for (const email of candidates) {
    if (isBlockedOutreachEmail(email)) continue
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
    const mx = await verifyEmailMxCached(email, bundle.mxStatusCache)
    if (mx.status === 'mx_check') {
      const strongPattern = bundle.seedEmails.length >= 2 && bundle.pattern
      return {
        verification_status: strongPattern ? 'mx_likely' : 'mx_check',
        source_details: { verify: mx.detail, pattern: bundle.pattern },
      }
    }
    return { verification_status: 'invalid', source_details: { verify: mx.detail } }
  }

  const mx = await verifyEmailMxCached(email, bundle.mxStatusCache)
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

export type EmailProvenance = {
  /** Public/API hit vs pattern assembly */
  method: 'found' | 'guessed'
  /** Where the address came from */
  origin:
    | 'hunter'
    | 'site_crawl'
    | 'web_snippet'
    | 'osint_worker'
    | 'pattern'
    | 'unknown'
  /** Inferred pattern key when guessed, e.g. {first}.{last} */
  pattern: string | null
  verification: 'verified' | 'likely' | 'unverified' | 'unknown'
  verification_status: string | null
  /** Short chip label */
  label: string
  /** One-line explanation under the email */
  detail: string
}

function formatPatternLabel(pattern: string | null | undefined): string {
  if (!pattern) return 'name pattern'
  const map: Record<string, string> = {
    '{first}.{last}': 'first.last',
    '{first}_{last}': 'first_last',
    '{first}{last}': 'firstlast',
    '{f}{last}': 'flast',
    '{f}.{last}': 'f.last',
  }
  return map[pattern] || pattern.replace(/[{}]/g, '')
}

function verificationTier(
  status: string | null | undefined,
): EmailProvenance['verification'] {
  const s = (status || '').toLowerCase()
  if (!s) return 'unknown'
  if (s === 'valid' || s === 'public') return 'verified'
  if (s === 'accept_all' || s === 'mx_likely') return 'likely'
  if (s === 'mx_check' || s === 'risky' || s === 'unknown') return 'unverified'
  return 'unknown'
}

function verificationPhrase(
  tier: EmailProvenance['verification'],
  status: string | null,
): string {
  switch (tier) {
    case 'verified':
      return status === 'public' ? 'seen publicly' : 'verified'
    case 'likely':
      return status === 'accept_all'
        ? 'likely (accept-all domain)'
        : 'likely (strong pattern + MX)'
    case 'unverified':
      return status === 'mx_check'
        ? 'MX checked, mailbox not confirmed'
        : 'not fully verified'
    default:
      return 'verification unknown'
  }
}

/**
 * Summarize how we got an email: found vs pattern-guessed, plus verification.
 * Safe to call for older contacts that only have sources + verification_status.
 */
export function buildEmailProvenance(opts: {
  sources?: string[] | null
  verification_status?: string | null
  source_details?: Record<string, unknown> | null
}): EmailProvenance {
  const sources = opts.sources || []
  const status = opts.verification_status || null
  const details = opts.source_details || {}
  const tier = verificationTier(status)

  const patternDetail = details.pattern as
    | { inferred?: string | null; candidates?: string[] }
    | undefined
  const pattern =
    typeof patternDetail?.inferred === 'string' ? patternDetail.inferred : null

  const hasHunter =
    sources.includes('hunter') || Boolean(details.hunter_email) ||
    Boolean(details.hunter)
  const hasSite = sources.includes('site_crawl')
  const hasSnippet = sources.includes('web_snippet')
  const hasWorker = sources.includes('osint_worker')
  const hasPattern = sources.includes('pattern')

  let method: EmailProvenance['method'] = 'found'
  let origin: EmailProvenance['origin'] = 'unknown'

  if (hasSite) {
    method = 'found'
    origin = 'site_crawl'
  } else if (hasSnippet) {
    method = 'found'
    origin = 'web_snippet'
  } else if (hasHunter || details.hunter_email) {
    method = 'found'
    origin = 'hunter'
  } else if (hasPattern) {
    method = 'guessed'
    origin = 'pattern'
  } else if (hasWorker) {
    method = 'found'
    origin = 'osint_worker'
  } else if (status === 'public') {
    method = 'found'
    origin = 'site_crawl'
  }

  const verifyBit = verificationPhrase(tier, status)
  let label: string
  let detail: string

  if (method === 'guessed') {
    const pLabel = formatPatternLabel(pattern)
    label = `Guessed · ${pLabel}`
    detail = `Assembled from ${pLabel} pattern · ${verifyBit}`
  } else {
    const originLabel: Record<EmailProvenance['origin'], string> = {
      hunter: 'Hunter.io',
      site_crawl: 'company site',
      web_snippet: 'web results',
      osint_worker: 'OSINT',
      pattern: 'pattern',
      unknown: 'public source',
    }
    label = `Found · ${originLabel[origin]}`
    detail = `Found via ${originLabel[origin]} · ${verifyBit}`
  }

  return {
    method,
    origin,
    pattern,
    verification: tier,
    verification_status: status,
    label,
    detail,
  }
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
