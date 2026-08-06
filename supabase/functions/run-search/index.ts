import {
  adminClient,
  corsHeaders,
  errorResponse,
  extractDomain,
  hunterGet,
  jsonResponse,
  requireUser,
  scoreOutreachTitle,
  titleMatchesFilters,
} from '../_shared/cors.ts'
import {
  discoverPersonEmailOsint,
  enrichCompanyOsint,
  finalizeOsintEmail,
  isHunterQuotaResponse,
  passesEmailVerification,
} from '../_shared/email_discovery.ts'

type Filters = {
  include_titles: string[]
  exclude_titles: string[]
  locations: string[]
  max_companies_per_run: number
  max_contacts_per_company: number
  require_verified_email: boolean
  accept_accept_all: boolean
  /** When false, email find/verify uses OSINT pipeline only. */
  enable_hunter?: boolean
}

type HunterRunState = {
  quotaExhausted: boolean
  quotaNote: string | null
}

type JobHit = {
  company_name: string
  title: string
  url: string
  candidate_domain: string | null
  source: string
  relevance?: number
}

type CompanyHit = {
  company_name: string
  domain: string | null
  url: string
  source: string
  hiring_signal?: string | null
  relevance?: number
}

const BROAD_PEOPLE_TITLES = [
  'Director',
  'Engineering Manager',
  'Principal Engineer',
  'Staff Engineer',
  'Research Scientist',
  'Senior Research Scientist',
  'Principal Scientist',
  'Senior Engineer',
  'Lead Engineer',
  'Research Engineer',
  'Compiler Engineer',
  'Technical Recruiter',
  'Talent Acquisition',
]

const SKIP_COMPANY_HOST_PARTS = [
  'indeed.',
  'glassdoor.',
  'ziprecruiter.',
  'monster.',
  'wikipedia.',
  'youtube.',
  'twitter.',
  'x.com',
  'facebook.',
  'reddit.',
  'remotive.',
  'adzuna.',
  'linkedin.com/jobs',
  'linkedin.com/pulse',
  'medium.com',
  'arxiv.org',
  'substack.com',
  'ghost.io',
  'blogspot.',
  'wordpress.com',
  'wixsite.com',
  'squarespace.com',
  'notion.site',
  'github.io',
  'beehiiv.com',
  'mailchimp.',
  'feedburner.',
  'techcrunch.com',
  'forbes.com',
  'businessinsider.com',
  'builtin.com',
  'crunchbase.com',
  'pitchbook.com',
  'cbinsights.com',
  'statista.com',
  'g2.com',
  'ycombinator.com',
  'news.ycombinator',
  'quantamagazine.org',
  'thequantuminsider.com',
  'nature.com/articles',
  'science.org',
  'ieee.org',
  'springer.com',
  'researchgate.net',
  'semiconductor-digest.com',
  'venturebeat.com',
  'prnewswire.com',
  'businesswire.com',
]

const LISTICLE_TITLE_RE =
  /\b(top\s*\d+|best\s*\d+|\d+\s+(best|top|leading)|list of|newsletter|podcast|webinar|interview with|how to|guide to|what is|ultimate guide|roundup|magazine|weekly|daily digest|blog\b|vs\.|review\b|careers page|job board)/i

function isSkippableCompanyHost(host: string): boolean {
  const h = host.toLowerCase()
  return SKIP_COMPANY_HOST_PARTS.some((p) => h.includes(p))
}

function isEmployerCorporateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  if (!h || isSkippableCompanyHost(h)) return false
  if (h.endsWith('.substack.com') || h === 'substack.com') return false
  if (h.endsWith('.github.io') || h.endsWith('.wordpress.com')) return false
  const parts = h.split('.')
  if (parts.length < 2) return false
  const tld = parts[parts.length - 1]
  if (!/^[a-z]{2,}$/i.test(tld)) return false
  return true
}

function isListicleOrPublisherTitle(text: string): boolean {
  const t = text.trim()
  if (!t || t.length < 2) return true
  if (LISTICLE_TITLE_RE.test(t)) return true
  if (/^\d{4}\s/.test(t)) return true
  return false
}

function looksLikeEmployerName(name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || n.length > 80) return false
  if (isListicleOrPublisherTitle(n)) return false
  const lower = n.toLowerCase()
  if (
    /\b(newsletter|blog|magazine|journal|insider|digest|podcast|substack|medium)\b/.test(
      lower,
    )
  ) {
    return false
  }
  if (/^(the|a)\s+\d+/i.test(n)) return false
  return true
}

function linkedInCompanyFromUrl(url: string): { name: string; url: string } | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('linkedin.com')) return null
    const m = u.pathname.match(/\/company\/([^/?#]+)/i)
    if (!m) return null
    const slug = m[1]
    const name = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    return { name, url: `https://www.linkedin.com/company/${slug}/` }
  } catch {
    return null
  }
}

function guessNameFromResultTitle(title: string): string | null {
  const cleaned = title
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
  const parts = cleaned.split(/\s[-–—|]\s/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  // Job-style: "Senior Engineer - IonQ" → employer often last segment
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    if (looksLikeEmployerName(last)) return last
  }
  const first = parts[0] || null
  if (first && looksLikeEmployerName(first)) return first
  return null
}

function extractLinkedInCompaniesFromText(
  text: string,
): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = []
  const seen = new Set<string>()
  const re = /linkedin\.com\/company\/([a-z0-9-]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const slug = m[1]
    const key = slug.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const hit = linkedInCompanyFromUrl(
      `https://www.linkedin.com/company/${slug}/`,
    )
    if (hit) out.push(hit)
  }
  return out
}

function pickCanonicalCompanyName(
  guessed: string,
  domain: string | null,
  hunterOrg: string | null,
): string {
  const candidates = [hunterOrg, guessed].filter(Boolean) as string[]
  for (const c of candidates) {
    if (looksLikeEmployerName(c)) return c.trim()
  }
  if (domain && isEmployerCorporateHost(domain)) {
    const fromDomain = domainToGuessName(domain)
    if (looksLikeEmployerName(fromDomain)) {
      return fromDomain.replace(/\b\w/g, (ch) => ch.toUpperCase())
    }
  }
  return guessed.trim()
}

function domainToGuessName(domain: string): string {
  const base = domain.replace(/^www\./, '').split('.')[0] || domain
  return base.replace(/[^a-z0-9]+/gi, ' ').trim()
}

/** Score company fit from name + optional hiring signal text. */
function scoreCompanyFit(
  companyName: string,
  signalText: string | null | undefined,
  roles: string[],
  industries: string[],
  skills: string[],
): number {
  const blob = `${companyName} ${signalText || ''}`
  return scoreJobRelevance(blob, roles, industries, skills)
}

function buildCompanyDiscoveryQueries(
  industries: string[],
  roles: string[],
  companyTypes: string[],
  skills: string[],
): string[] {
  const queries: string[] = []
  const inds =
    industries.length > 0 ? industries : companyTypes.slice(0, 4).filter(Boolean)

  const sizeAngles = [
    'startups',
    'scale-up companies',
    'public companies',
    'Fortune 500',
    'mid-size companies',
    'research labs',
    'national labs',
    'university spinouts',
    'unicorn companies',
    'hardware companies',
    'software companies',
  ]

  const ctLower = companyTypes.map((c) => c.toLowerCase())
  const wantsStartup = ctLower.some((c) =>
    /startup|early|seed|series|venture|unicorn/i.test(c),
  )
  const wantsLarge = ctLower.some((c) =>
    /fortune|enterprise|public|faang|big tech|multinational/i.test(c),
  )
  const wantsLab = ctLower.some((c) =>
    /lab|national|research institute|academia|university/i.test(c),
  )

  const pickSizes = (): string[] => {
    const picked: string[] = []
    if (wantsStartup) picked.push('startups', 'scale-up companies', 'unicorn companies')
    if (wantsLarge) picked.push('public companies', 'Fortune 500', 'enterprise companies')
    if (wantsLab) picked.push('research labs', 'national labs', 'university spinouts')
    if (picked.length === 0) {
      return ['startups', 'companies', 'public companies', 'research labs']
    }
    return picked
  }

  const sizes = pickSizes()

  for (const ind of inds.slice(0, 5)) {
    const i = ind.trim()
    if (!i) continue
    for (const size of sizes.slice(0, 4)) {
      queries.push(`${i} ${size}`)
    }
    queries.push(`site:linkedin.com/company ${i}`)
    queries.push(`${i} company careers hiring`)
    if (/quantum|qubit|compiler|architecture|risc|silicon|accelerator|hpc/i.test(i)) {
      queries.push(`${i} semiconductor companies`)
      queries.push(`${i} quantum hardware companies`)
    }
  }
  for (const ct of companyTypes.slice(0, 4)) {
    const c = ct.trim()
    if (c) queries.push(`${c} companies hiring`)
  }
  for (const role of roles.slice(0, 3)) {
    const r = role.trim()
    if (r) queries.push(`${r} employers startups`)
  }
  if (queries.length === 0 && skills.length > 0) {
    queries.push(`${skills.slice(0, 2).join(' ')} companies`)
  }
  const seen = new Set<string>()
  return queries.filter((q) => {
    const key = q.toLowerCase().trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 14)
}

function departmentKeywords(
  industries: string[],
  companyTypes: string[],
  outreachTargets: string[],
  skills: string[],
  roles: string[],
): string[] {
  const words = new Set<string>()
  const seeds = [
    ...industries,
    ...companyTypes,
    ...outreachTargets,
    ...roles,
    ...skills.slice(0, 6),
    'Quantum',
    'Architecture',
    'Compiler',
    'Research',
    'Hardware',
    'Systems',
    'Accelerator',
    'Silicon',
  ]
  for (const s of seeds) {
    for (const tok of s.split(/[\s/|,]+/)) {
      const t = tok.trim()
      if (t.length > 3) words.add(t)
    }
  }
  return [...words].slice(0, 10)
}

function peopleSearchTitles(include: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [...include, ...BROAD_PEOPLE_TITLES]) {
    const key = t.toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.slice(0, 10)
}

async function runWebSearch(
  q: string,
  num: number,
): Promise<Array<{ title?: string; link?: string; url?: string; snippet?: string }>> {
  const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
  const serperKey = Deno.env.get('SERPER_API_KEY')
  if (!bingKey && !serperKey) return []

  if (serperKey) {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q, num }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body?.message || `Serper ${res.status}`)
    return body.organic || []
  }

  const url = new URL('https://api.bing.microsoft.com/v7.0/search')
  url.searchParams.set('q', q)
  url.searchParams.set('count', String(num))
  const res = await fetch(url.toString(), {
    headers: { 'Ocp-Apim-Subscription-Key': bingKey! },
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.message || `Bing ${res.status}`)
  return (body.webPages?.value || []).map(
    (v: { name?: string; url?: string; snippet?: string }) => ({
      title: v.name,
      link: v.url,
      snippet: v.snippet,
    }),
  )
}

async function discoverCompaniesFromWeb(
  queries: string[],
  roles: string[],
  industries: string[],
  skills: string[],
  stats: { attempted: number; found: number; errors: string[] },
): Promise<CompanyHit[]> {
  const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
  const serperKey = Deno.env.get('SERPER_API_KEY')
  if (!bingKey && !serperKey) return []

  const byKey = new Map<string, CompanyHit>()

  const storeHit = (hit: CompanyHit, key: string) => {
    if (!looksLikeEmployerName(hit.company_name)) return
    const prev = byKey.get(key)
    if (!prev || (hit.relevance || 0) > (prev.relevance || 0)) {
      byKey.set(key, hit)
    }
  }

  const storeLinkedInCompany = (
    liCo: { name: string; url: string },
    context: string,
    query: string,
    boost = 2,
  ) => {
    const relevance =
      scoreCompanyFit(liCo.name, context, roles, industries, skills) + boost
    storeHit(
      {
        company_name: liCo.name,
        domain: null,
        url: liCo.url,
        source: 'web_company',
        hiring_signal: null,
        relevance,
      },
      liCo.name.toLowerCase(),
    )
  }

  for (const query of queries.slice(0, 6)) {
    stats.attempted += 1
    try {
      const organic = await runWebSearch(query, 10)
      stats.found += organic.length
      for (const item of organic) {
        const link = item.link || item.url || ''
        const snippet = item.snippet || ''
        const title = item.title || ''
        const blob = `${title} ${snippet} ${link}`

        for (const liCo of extractLinkedInCompaniesFromText(blob)) {
          storeLinkedInCompany(liCo, blob, query, 3)
        }

        const liCo = linkedInCompanyFromUrl(link)
        if (liCo) {
          storeLinkedInCompany(liCo, blob, query, 2)
          continue
        }

        let host: string | null = null
        try {
          host = new URL(link).hostname.replace(/^www\./, '')
        } catch {
          continue
        }
        if (!host || isSkippableCompanyHost(host)) continue
        if (!isEmployerCorporateHost(host)) continue

        const domain = extractDomain(link)
        if (!domain || !isEmployerCorporateHost(domain)) continue

        const guessed =
          guessNameFromResultTitle(title) ||
          domainToGuessName(domain)
        if (!looksLikeEmployerName(guessed)) continue

        const relevance = scoreCompanyFit(
          guessed,
          `${snippet} ${title} ${query}`,
          roles,
          industries,
          skills,
        )
        const key = domain.toLowerCase()
        storeHit(
          {
            company_name: guessed,
            domain,
            url: link,
            source: 'web_company',
            hiring_signal: null,
            relevance,
          },
          key,
        )
      }
    } catch (e) {
      stats.errors.push(
        e instanceof Error ? e.message : `Company search failed: ${query}`,
      )
    }
  }

  return [...byKey.values()]
}

function jobHitsToCompanies(jobs: JobHit[]): CompanyHit[] {
  return jobs.map((job) => ({
    company_name: job.company_name,
    domain:
      job.candidate_domain ||
      extractDomain(job.url) ||
      slugDomainGuess(job.company_name),
    url: job.url,
    source: job.source,
    hiring_signal: job.title,
    relevance: job.relevance,
  }))
}

function pickBetterCompanyName(a: string, b: string): string {
  const aOk = looksLikeEmployerName(a)
  const bOk = looksLikeEmployerName(b)
  if (aOk && !bOk) return a
  if (bOk && !aOk) return b
  return a || b
}

function mergeCompanyLists(
  primary: CompanyHit[],
  supplemental: CompanyHit[],
): CompanyHit[] {
  const map = new Map<string, CompanyHit>()
  const put = (c: CompanyHit) => {
    const key = (c.domain || c.company_name).toLowerCase()
    const prev = map.get(key)
    if (!prev) {
      map.set(key, c)
      return
    }
    const relevance = Math.max(prev.relevance || 0, c.relevance || 0)
    map.set(key, {
      company_name: pickBetterCompanyName(prev.company_name, c.company_name),
      domain: prev.domain || c.domain,
      url: prev.url || c.url,
      source: prev.source === 'web_company' ? prev.source : c.source,
      hiring_signal: prev.hiring_signal || c.hiring_signal,
      relevance,
    })
  }
  for (const c of primary) put(c)
  for (const c of supplemental) put(c)
  return [...map.values()]
}

type Candidate = {
  first_name: string | null
  last_name: string | null
  full_name: string | null
  title: string | null
  email: string | null
  linkedin_url: string | null
  verification_status: string | null
  sources: string[]
  source_details: Record<string, unknown>
}

/** Score how well a job opening matches the user's target roles / industries. */
function scoreJobRelevance(
  jobTitle: string,
  roles: string[],
  industries: string[],
  skills: string[],
): number {
  const t = jobTitle.toLowerCase()
  let score = 0

  for (const role of roles) {
    const r = role.toLowerCase().trim()
    if (!r) continue
    if (t.includes(r)) {
      score += 12
      continue
    }
    const tokens = r.split(/[\s/|,]+/).filter((w) => w.length > 2)
    const hits = tokens.filter((tok) => t.includes(tok)).length
    if (hits > 0) score += hits * 3
    if (tokens.length > 0 && hits >= Math.ceil(tokens.length * 0.6)) score += 4
  }

  for (const ind of industries) {
    const i = ind.toLowerCase().trim()
    if (i && t.includes(i)) score += 6
    else {
      const tokens = i.split(/[\s/|,]+/).filter((w) => w.length > 3)
      if (tokens.some((tok) => t.includes(tok))) score += 3
    }
  }

  for (const skill of skills.slice(0, 8)) {
    const s = skill.toLowerCase().trim()
    if (s.length > 2 && t.includes(s)) score += 1
  }

  return score
}

function buildJobQueries(
  roles: string[],
  industries: string[],
  skills: string[],
): string[] {
  const queries: string[] = []
  const inds = industries.slice(0, 3)
  const roleList = roles.slice(0, 5)

  for (const role of roleList) {
    queries.push(role)
    if (inds[0]) queries.push(`${role} ${inds[0]}`)
  }
  if (roleList.length === 0 && inds[0]) {
    queries.push(inds[0])
    if (skills[0]) queries.push(`${inds[0]} ${skills[0]}`)
  }
  if (queries.length === 0) {
    queries.push(skills.slice(0, 2).join(' ') || 'software engineer')
  }

  // Dedupe while preserving order
  const seen = new Set<string>()
  return queries.filter((q) => {
    const key = q.toLowerCase().trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 6)
}

type SourceStats = {
  configured: boolean
  attempted: number
  people_found: number
  after_title_filter: number
  with_email: number
  contacts_kept: number
  errors: string[]
  note?: string | null
}

function emptyStats(configured: boolean, note?: string | null): SourceStats {
  return {
    configured,
    attempted: 0,
    people_found: 0,
    after_title_filter: 0,
    with_email: 0,
    contacts_kept: 0,
    errors: [],
    note: note ?? null,
  }
}

function dedupeKey(c: Candidate, domain: string): string {
  if (c.email) return `email:${c.email.toLowerCase()}`
  if (c.linkedin_url) {
    return `li:${c.linkedin_url.toLowerCase().replace(/\/$/, '')}`
  }
  const name = (c.full_name || `${c.first_name || ''} ${c.last_name || ''}`)
    .trim()
    .toLowerCase()
  return `name:${domain}:${name}:${(c.title || '').toLowerCase()}`
}

function mergeCandidate(into: Candidate, from: Candidate): Candidate {
  return {
    first_name: into.first_name || from.first_name,
    last_name: into.last_name || from.last_name,
    full_name: into.full_name || from.full_name,
    title: into.title || from.title,
    email: into.email || from.email,
    linkedin_url: into.linkedin_url || from.linkedin_url,
    verification_status: into.verification_status || from.verification_status,
    sources: [...new Set([...into.sources, ...from.sources])],
    source_details: { ...into.source_details, ...from.source_details },
  }
}

type ContactIndex = {
  emails: Set<string>
  linkedinSlugs: Set<string>
  nameAtCompany: Set<string>
  total: number
}

function linkedInSlug(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const m = u.pathname.match(/\/in\/([^/?#]+)/i)
    return m ? m[1].toLowerCase() : null
  } catch {
    return null
  }
}

function contactDisplayName(c: Candidate): string {
  return (
    c.full_name ||
    [c.first_name, c.last_name].filter(Boolean).join(' ') ||
    ''
  ).trim()
}

function buildContactIndex(
  rows: Array<{
    email?: string | null
    linkedin_url?: string | null
    full_name?: string | null
    first_name?: string | null
    last_name?: string | null
    company_id?: string
  }>,
): ContactIndex {
  const emails = new Set<string>()
  const linkedinSlugs = new Set<string>()
  const nameAtCompany = new Set<string>()
  for (const row of rows) {
    if (row.email) emails.add(row.email.toLowerCase().trim())
    const slug = linkedInSlug(row.linkedin_url)
    if (slug) linkedinSlugs.add(slug)
    const name = (
      row.full_name ||
      [row.first_name, row.last_name].filter(Boolean).join(' ')
    )
      .trim()
      .toLowerCase()
    if (name && row.company_id) nameAtCompany.add(`${row.company_id}:${name}`)
  }
  return {
    emails,
    linkedinSlugs,
    nameAtCompany,
    total: rows.length,
  }
}

function contactAlreadyKnown(
  cand: Candidate,
  companyId: string,
  index: ContactIndex,
): boolean {
  if (cand.email && index.emails.has(cand.email.toLowerCase().trim())) {
    return true
  }
  const slug = linkedInSlug(cand.linkedin_url)
  if (slug && index.linkedinSlugs.has(slug)) return true
  const name = contactDisplayName(cand).toLowerCase()
  if (name && index.nameAtCompany.has(`${companyId}:${name}`)) return true
  return false
}

function registerContactInIndex(
  index: ContactIndex,
  cand: Candidate,
  companyId: string,
) {
  if (cand.email) index.emails.add(cand.email.toLowerCase().trim())
  const slug = linkedInSlug(cand.linkedin_url)
  if (slug) index.linkedinSlugs.add(slug)
  const name = contactDisplayName(cand).toLowerCase()
  if (name) index.nameAtCompany.add(`${companyId}:${name}`)
  index.total += 1
}

async function fetchRemotiveJobs(query: string): Promise<JobHit[]> {
  const url = new URL('https://remotive.com/api/remote-jobs')
  if (query) url.searchParams.set('search', query)
  url.searchParams.set('limit', '50')
  const res = await fetch(url.toString())
  if (!res.ok) return []
  const body = await res.json()
  return ((body.jobs || []) as Array<{
    company_name?: string
    title?: string
    url?: string
  }>)
    .filter((j) => j.company_name && j.title)
    .map((j) => ({
      company_name: j.company_name!,
      title: j.title!,
      url: j.url || '',
      candidate_domain: null,
      source: 'remotive',
    }))
}

async function fetchAdzunaJobs(query: string, location: string): Promise<JobHit[]> {
  const appId = Deno.env.get('ADZUNA_APP_ID')
  const appKey = Deno.env.get('ADZUNA_APP_KEY')
  if (!appId || !appKey) return []
  const url = new URL('https://api.adzuna.com/v1/api/jobs/us/search/1')
  url.searchParams.set('app_id', appId)
  url.searchParams.set('app_key', appKey)
  url.searchParams.set('results_per_page', '30')
  url.searchParams.set('what', query)
  if (location) url.searchParams.set('where', location)
  const res = await fetch(url.toString())
  if (!res.ok) return []
  const body = await res.json()
  return ((body.results || []) as Array<{
    company?: { display_name?: string }
    title?: string
    redirect_url?: string
  }>)
    .filter((j) => j.company?.display_name && j.title)
    .map((j) => ({
      company_name: j.company!.display_name!,
      title: j.title!,
      url: j.redirect_url || '',
      candidate_domain: extractDomain(j.redirect_url),
      source: 'adzuna',
    }))
}

function slugDomainGuess(company: string): string | null {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 40)
  return slug.length >= 2 ? `${slug}.com` : null
}

/** Free Hunter plans cap domain-search at 10 — request 10 and soft-handle the notice. */
async function searchHunter(
  domain: string,
  stats: SourceStats,
  state: HunterRunState,
): Promise<{ people: Candidate[]; organization: string | null }> {
  stats.attempted += 1
  const key = Deno.env.get('HUNTER_API_KEY')
  if (!key) return { people: [], organization: null }

  try {
    const url = new URL('https://api.hunter.io/v2/domain-search')
    url.searchParams.set('domain', domain)
    url.searchParams.set('limit', '10')
    url.searchParams.set('type', 'personal')

    const res = await fetch(url.toString(), {
      headers: { 'X-API-Key': key },
    })
    const body = await res.json()
    if (isHunterQuotaResponse(res.status, body)) {
      state.quotaExhausted = true
      state.quotaNote = 'Hunter monthly credits exhausted — using OSINT email pipeline'
      stats.errors.push(state.quotaNote)
      return { people: [], organization: null }
    }
    const organization =
      typeof body?.data?.organization === 'string'
        ? body.data.organization.trim()
        : null
    const emails = (body?.data?.emails || []) as Array<{
      value?: string
      first_name?: string
      last_name?: string
      position?: string
      linkedin?: string
      verification?: { status?: string }
    }>

    // Plan-limit messages often accompany usable 10-result payloads — don't spam Errors.
    const errDetail = body?.errors?.[0]?.details || body?.errors?.[0]?.id || ''
    if (!res.ok && emails.length === 0) {
      stats.errors.push(errDetail || `Hunter ${res.status}`)
      return { people: [], organization }
    }
    if (errDetail && /limited to 10/i.test(String(errDetail)) && emails.length > 0) {
      // informational only — already capped at 10
    } else if (!res.ok && emails.length > 0) {
      // got partial data despite error status
    } else if (!res.ok) {
      stats.errors.push(errDetail || `Hunter ${res.status}`)
      return { people: [], organization }
    }

    stats.people_found += emails.length
    const people = emails.slice(0, 10).map((p) => {
      const full = [p.first_name, p.last_name].filter(Boolean).join(' ')
      return {
        first_name: p.first_name || null,
        last_name: p.last_name || null,
        full_name: full || null,
        title: p.position || null,
        email: p.value || null,
        linkedin_url: p.linkedin || null,
        verification_status: p.verification?.status || null,
        sources: ['hunter'],
        source_details: {
          hunter: { via: 'domain-search', domain, limit: 10 },
        },
      } satisfies Candidate
    })
    return { people, organization }
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : 'Hunter failed')
    return { people: [], organization: null }
  }
}

async function hunterEmailFinder(
  domain: string,
  first_name: string,
  last_name: string,
  state: HunterRunState,
): Promise<{
  email: string | null
  verification_status: string | null
} | null> {
  if (state.quotaExhausted) return null
  const key = Deno.env.get('HUNTER_API_KEY')
  if (!key) return null
  const url = new URL('https://api.hunter.io/v2/email-finder')
  url.searchParams.set('domain', domain)
  url.searchParams.set('first_name', first_name)
  url.searchParams.set('last_name', last_name)
  const res = await fetch(url.toString(), { headers: { 'X-API-Key': key } })
  const body = await res.json()
  if (isHunterQuotaResponse(res.status, body)) {
    state.quotaExhausted = true
    state.quotaNote = 'Hunter monthly credits exhausted — using OSINT email pipeline'
    return null
  }
  if (!res.ok) return null
  return {
    email: body?.data?.email || null,
    verification_status: body?.data?.verification?.status || null,
  }
}

async function hunterEmailVerifier(
  email: string,
  state: HunterRunState,
): Promise<string | null> {
  if (state.quotaExhausted) return null
  try {
    const verified = await hunterGet('email-verifier', { email })
    return verified?.data?.status || null
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/credit|quota|limit|monthly|402|429/i.test(msg)) {
      state.quotaExhausted = true
      state.quotaNote = 'Hunter monthly credits exhausted — using OSINT email pipeline'
    }
    return null
  }
}

function parseLinkedInTitle(title: string, companyName: string): {
  full_name: string | null
  person_title: string | null
} {
  // Typical: "Jane Doe - Engineering Manager - Acme | LinkedIn"
  const cleaned = title
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
  const parts = cleaned.split(/\s[-–—]\s/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return { full_name: null, person_title: null }

  const full_name = parts[0] || null
  let person_title: string | null = null
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].toLowerCase() === companyName.toLowerCase()) continue
    person_title = parts[i]
    break
  }
  return { full_name, person_title }
}

function extractLinkedInUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('linkedin.com')) return null
    const m = u.pathname.match(/\/in\/([^/?#]+)/i)
    if (!m) return null
    return `https://www.linkedin.com/in/${m[1]}`
  } catch {
    return null
  }
}

function splitName(full: string | null): {
  first_name: string | null
  last_name: string | null
} {
  if (!full) return { first_name: null, last_name: null }
  const bits = full.split(/\s+/).filter(Boolean)
  if (bits.length === 1) return { first_name: bits[0], last_name: null }
  return {
    first_name: bits[0],
    last_name: bits.slice(1).join(' '),
  }
}

/**
 * Free-ish LinkedIn *discovery* via search APIs (not scraping linkedin.com).
 * Uses Bing (free Azure F0 tier) or Serper if configured.
 */
async function searchWebLinkedIn(
  companyName: string,
  domain: string,
  titles: string[],
  stats: SourceStats,
  deptKeywords: string[] = [],
): Promise<Candidate[]> {
  const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
  const serperKey = Deno.env.get('SERPER_API_KEY')
  if (!bingKey && !serperKey) return []

  stats.attempted += 1
  const titleClause = titles
    .slice(0, 6)
    .map((t) => `"${t}"`)
    .join(' OR ')
  const deptClause = deptKeywords
    .slice(0, 5)
    .map((k) => `"${k}"`)
    .join(' OR ')

  const queries = [
    deptClause
      ? `site:linkedin.com/in "${companyName}" (${deptClause})`
      : `site:linkedin.com/in (${titleClause}) "${companyName}"`,
    `site:linkedin.com/in (${titleClause}) "${companyName}"`,
  ]

  try {
    const out: Candidate[] = []
    const seen = new Set<string>()
    const via = serperKey ? 'serper' : 'bing'

    for (const q of queries.slice(0, 1)) {
      const organic = await runWebSearch(q, 6)
      for (const item of organic) {
        const link = item.link || item.url || ''
        const li = extractLinkedInUrl(link)
        if (!li || seen.has(li)) continue
        seen.add(li)
        const parsed = parseLinkedInTitle(item.title || '', companyName)
        const names = splitName(parsed.full_name)
        out.push({
          first_name: names.first_name,
          last_name: names.last_name,
          full_name: parsed.full_name,
          title: parsed.person_title,
          email: null,
          linkedin_url: li,
          verification_status: null,
          sources: ['websearch'],
          source_details: {
            websearch: {
              via,
              query: q,
              domain,
              snippet: item.snippet || null,
            },
          },
        })
      }
    }

    stats.people_found += out.length
    return out
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : 'Web search failed')
    return []
  }
}

async function searchProxycurl(
  domain: string,
  companyName: string,
  titles: string[],
  stats: SourceStats,
): Promise<Candidate[]> {
  const key = Deno.env.get('PROXYCURL_API_KEY')
  if (!key) return []
  stats.attempted += 1

  try {
    const roleExpr = titles
      .slice(0, 6)
      .map((t) => t.replace(/[()]/g, ' ').trim())
      .filter(Boolean)
      .join(' OR ')

    const url = new URL('https://nubela.co/proxycurl/api/v2/search/person')
    url.searchParams.set('current_company_domain_name', domain)
    if (roleExpr) url.searchParams.set('current_role_title', roleExpr)
    url.searchParams.set('page_size', '10')
    url.searchParams.set('enrich_profiles', 'enrich')

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    })
    const body = await res.json()
    if (!res.ok) {
      stats.errors.push(body?.description || body?.error || `Proxycurl ${res.status}`)
      return []
    }

    const results = (body.results || []) as Array<{
      linkedin_profile_url?: string
      profile?: {
        full_name?: string
        first_name?: string
        last_name?: string
        occupation?: string
        experiences?: Array<{ title?: string }>
      }
    }>
    stats.people_found += results.length
    return results.map((r) => {
      const profile = r.profile || {}
      const title =
        profile.occupation || profile.experiences?.[0]?.title || null
      const full =
        profile.full_name ||
        [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
        null
      return {
        first_name: profile.first_name || null,
        last_name: profile.last_name || null,
        full_name: full,
        title,
        email: null,
        linkedin_url: r.linkedin_profile_url || null,
        verification_status: null,
        sources: ['proxycurl'],
        source_details: {
          proxycurl: { via: 'v2/search/person', domain, company: companyName },
        },
      } satisfies Candidate
    })
  } catch (e) {
    stats.errors.push(e instanceof Error ? e.message : 'Proxycurl failed')
    return []
  }
}

async function setProgress(
  admin: ReturnType<typeof adminClient>,
  runId: string | null,
  patch: {
    stage?: string
    progress?: number
    message?: string
    detail?: string | null
    current_company?: string | null
    companies_total?: number
    companies_done?: number
    status?: 'running' | 'done' | 'failed' | 'cancelled'
    summary?: unknown
    error?: string | null
  },
) {
  if (!runId) return
  if (await runWasCancelled(admin, runId)) return
  await admin
    .from('search_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
}

async function runWasCancelled(
  admin: ReturnType<typeof adminClient>,
  runId: string | null,
): Promise<boolean> {
  if (!runId) return false
  const { data } = await admin
    .from('search_runs')
    .select('status')
    .eq('id', runId)
    .maybeSingle()
  return data?.status === 'cancelled'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let runId: string | null = null
  const admin = adminClient()
  const runStartedMs = Date.now()
  const RUN_BUDGET_MS = 125_000

  const overRunBudget = () => Date.now() - runStartedMs > RUN_BUDGET_MS

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth

    const body = await req.json().catch(() => ({}))
    runId = typeof body.run_id === 'string' ? body.run_id : null
    const depth = (body.depth as string) || 'standard'
    const depthCaps: Record<string, { companies: number; per: number }> = {
      quick: { companies: 3, per: 2 },
      standard: { companies: 6, per: 3 },
      deep: { companies: 8, per: 4 },
    }
    const caps = depthCaps[depth] || depthCaps.standard

    if (!runId) {
      const { data: created, error: createErr } = await admin
        .from('search_runs')
        .insert({
          user_id: user.id,
          status: 'running',
          stage: 'starting',
          progress: 2,
          message: 'Starting people search…',
        })
        .select('id')
        .single()
      if (createErr || !created) {
        return errorResponse(createErr?.message || 'Could not create search run', 500)
      }
      runId = created.id
    } else {
      const { data: existing } = await admin
        .from('search_runs')
        .select('id, user_id')
        .eq('id', runId)
        .maybeSingle()
      if (!existing || existing.user_id !== user.id) {
        return errorResponse('Invalid search run', 403)
      }
      if (existing.status === 'cancelled') {
        return jsonResponse({ ok: false, run_id: runId, cancelled: true })
      }
      await setProgress(admin, runId, {
        status: 'running',
        stage: 'starting',
        progress: 2,
        message: 'Starting people search…',
      })
    }

    await setProgress(admin, runId, {
      stage: 'loading_profile',
      progress: 8,
      message: 'Loading your profile and filters…',
    })

    const { data: profileRow } = await admin
      .from('search_profiles')
      .select('profile')
      .eq('user_id', user.id)
      .maybeSingle()

    const { data: filterRow } = await admin
      .from('search_filters')
      .select('filters')
      .eq('user_id', user.id)
      .maybeSingle()

    const profile = (profileRow?.profile || {}) as {
      roles?: string[]
      skills?: string[]
      industries?: string[]
      company_types?: string[]
      outreach_targets?: string[]
      locations?: string[]
      roles_confirmed?: boolean
    }
    const filters = (filterRow?.filters || {}) as Filters
    const include = filters.include_titles || []
    const exclude = filters.exclude_titles || []
    const maxCompanies = Math.min(
      caps.companies,
      filters.max_companies_per_run || caps.companies,
      10,
    )
    const maxPerCompany = Math.min(
      caps.per,
      filters.max_contacts_per_company || caps.per,
      5,
    )

    await setProgress(admin, runId, {
      detail: `Depth: ${depth} · up to ${maxCompanies} companies × ${maxPerCompany} contacts`,
    })

    const hunterKey = Deno.env.get('HUNTER_API_KEY')
    const proxyKey = Deno.env.get('PROXYCURL_API_KEY')
    const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
    const serperKey = Deno.env.get('SERPER_API_KEY')
    const webConfigured = Boolean(bingKey || serperKey)
    const hunterEnabled = filters.enable_hunter !== false
    const osintWorkerConfigured = Boolean(Deno.env.get('OSINT_WORKER_URL'))
    const hunterState: HunterRunState = {
      quotaExhausted: false,
      quotaNote: null,
    }

    const hunterNote = !hunterKey
      ? 'HUNTER_API_KEY missing'
      : !hunterEnabled
        ? 'Disabled in Filters — OSINT email pipeline'
        : 'Domain search (10/domain); finder/verify when credits available'

    const source_stats: Record<string, SourceStats> = {
      hunter: emptyStats(Boolean(hunterKey) && hunterEnabled, hunterNote),
      osint: emptyStats(
        true,
        osintWorkerConfigured
          ? 'Site crawl + pattern + OSINT worker'
          : 'Site crawl + pattern (set OSINT_WORKER_URL for theHarvester)',
      ),
      websearch: emptyStats(
        webConfigured,
        webConfigured
          ? serperKey
            ? 'Serper → LinkedIn profile URLs'
            : 'Bing → LinkedIn profile URLs'
          : 'Set SERPER_API_KEY or BING_SEARCH_API_KEY',
      ),
      proxycurl: emptyStats(
        Boolean(proxyKey),
        proxyKey ? null : 'Optional — PROXYCURL_API_KEY',
      ),
    }

    const targetRoles = profile.roles || []
    const industries = profile.industries || []
    const companyTypes = profile.company_types || []
    const outreachTargets = profile.outreach_targets || []
    const skills = profile.skills || []
    const jobQueries = buildJobQueries(targetRoles, industries, skills)
    const companyQueries = buildCompanyDiscoveryQueries(
      industries,
      targetRoles,
      companyTypes,
      skills,
    )
    const deptKeywords = departmentKeywords(
      industries,
      companyTypes,
      outreachTargets,
      skills,
      targetRoles,
    )
    const peopleTitles = peopleSearchTitles([
      ...include,
      ...outreachTargets,
    ])
    const company_discovery_stats = {
      attempted: 0,
      found: 0,
      errors: [] as string[],
    }
    const location =
      (filters.locations && filters.locations[0]) ||
      (profile.locations && profile.locations[0]) ||
      ''

    await setProgress(admin, runId, {
      stage: 'discovering_companies',
      progress: 12,
      message: 'Finding companies in your industries (not job boards first)…',
      detail: `Queries: ${companyQueries
        .slice(0, 3)
        .map((q) => `“${q}”`)
        .join(', ')}${companyQueries.length > 3 ? '…' : ''}`,
    })

    const webCompanies = webConfigured
      ? await discoverCompaniesFromWeb(
          companyQueries,
          targetRoles,
          industries,
          skills,
          company_discovery_stats,
        )
      : []

    await setProgress(admin, runId, {
      stage: 'fetching_jobs',
      progress: 18,
      message: 'Supplementing with job-board hiring signals…',
      detail: `Job queries: ${jobQueries
        .slice(0, 2)
        .map((q) => `“${q}”`)
        .join(', ')}${jobQueries.length > 2 ? '…' : ''}`,
    })

    const jobBatches = await Promise.all(
      jobQueries.map(async (q) => {
        const [remotive, adzuna] = await Promise.all([
          fetchRemotiveJobs(q),
          fetchAdzunaJobs(q, location),
        ])
        return [...remotive, ...adzuna]
      }),
    )
    const allJobs = jobBatches.flat()
    const remotiveCount = allJobs.filter((j) => j.source === 'remotive').length
    const adzunaCount = allJobs.filter((j) => j.source === 'adzuna').length

    const byCompany = new Map<string, JobHit>()
    for (const job of allJobs) {
      const relevance = scoreJobRelevance(
        job.title,
        targetRoles,
        industries,
        skills,
      )
      const scored = { ...job, relevance }
      const key = job.company_name.toLowerCase()
      const prev = byCompany.get(key)
      if (!prev || (scored.relevance || 0) > (prev.relevance || 0)) {
        byCompany.set(key, scored)
      }
    }

    const jobCompanies = jobHitsToCompanies([...byCompany.values()])
    let mergedCompanies = mergeCompanyLists(webCompanies, jobCompanies)

    const { data: flaggedRows } = await admin
      .from('companies')
      .select('name, domain, user_flag')
      .eq('user_id', user.id)
      .not('user_flag', 'is', null)

    const avoidDomains = new Set<string>()
    const avoidNames = new Set<string>()
    const favoriteDomains = new Set<string>()
    const favoriteNames = new Set<string>()
    for (const row of flaggedRows || []) {
      const n = (row.name || '').toLowerCase().trim()
      const d = (row.domain || '').toLowerCase().trim()
      if (row.user_flag === 'avoid') {
        if (n) avoidNames.add(n)
        if (d) avoidDomains.add(d)
      } else if (row.user_flag === 'favorite') {
        if (n) favoriteNames.add(n)
        if (d) favoriteDomains.add(d)
      }
    }

    const isAvoidedCompany = (name: string, domain: string | null) => {
      const d = (domain || '').toLowerCase()
      if (d && avoidDomains.has(d)) return true
      return avoidNames.has(name.toLowerCase().trim())
    }

    const favoriteBoost = (name: string, domain: string | null) => {
      const d = (domain || '').toLowerCase()
      if (d && favoriteDomains.has(d)) return 8
      if (favoriteNames.has(name.toLowerCase().trim())) return 8
      return 0
    }

    mergedCompanies = mergedCompanies.filter(
      (c) => !isAvoidedCompany(c.company_name, c.domain),
    )

    mergedCompanies = mergedCompanies.filter((c) => {
      if (!looksLikeEmployerName(c.company_name)) return false
      const d = c.domain || extractDomain(c.url) || null
      if (d && !isEmployerCorporateHost(d)) return false
      return true
    })

    for (const c of mergedCompanies) {
      const base = scoreCompanyFit(
        c.company_name,
        c.hiring_signal,
        targetRoles,
        industries,
        skills,
      )
      c.relevance =
        base +
        (c.source === 'web_company' ? 4 : 0) +
        (c.hiring_signal ? 2 : 0) +
        favoriteBoost(c.company_name, c.domain)
    }

    let ranked = [...mergedCompanies].sort(
      (a, b) => (b.relevance || 0) - (a.relevance || 0),
    )
    const strong = ranked.filter((c) => (c.relevance || 0) >= 3)
    if (strong.length >= Math.min(3, maxCompanies)) {
      ranked = strong
    }
    const selected = ranked.slice(0, maxCompanies)

    const { data: knownContactRows } = await admin
      .from('contacts')
      .select(
        'email, linkedin_url, full_name, first_name, last_name, company_id, review_status',
      )
      .eq('user_id', user.id)

    const contactIndex = buildContactIndex(knownContactRows || [])

    await setProgress(admin, runId, {
      detail: `${contactIndex.total} known contact(s) on file (kept / discarded / archived / pending) — duplicates skipped`,
    })

    await setProgress(admin, runId, {
      stage: 'companies_ready',
      progress: 25,
      message: `${webCompanies.length} industry companies + ${allJobs.length} jobs → ${selected.length} ranked targets`,
      detail: `Top: ${selected
        .slice(0, 3)
        .map((c) => `${c.company_name} (${c.relevance || 0})`)
        .join(' · ') || 'none'}`,
      companies_total: selected.length,
      companies_done: 0,
    })

    let contactsCreated = 0
    let contactsSkippedDuplicate = 0
    let companiesSelected = 0
    const company_reports: Array<Record<string, unknown>> = []
    const errors: string[] = []

    for (let i = 0; i < selected.length; i++) {
      if (await runWasCancelled(admin, runId)) {
        break
      }
      if (overRunBudget()) {
        errors.push(
          'Search time budget reached — try Quick or Standard depth, or run again.',
        )
        await setProgress(admin, runId, {
          message: 'Stopping early to avoid platform timeout…',
          detail: `Processed ${i} of ${selected.length} companies`,
        })
        break
      }

      const company = selected[i]
      const pct = 25 + Math.round(((i + 0.5) / Math.max(selected.length, 1)) * 65)

      await setProgress(admin, runId, {
        stage: 'searching_people',
        progress: pct,
        message: `Searching people at ${company.company_name}…`,
        detail: `Company ${i + 1} of ${selected.length}`,
        current_company: company.company_name,
        companies_total: selected.length,
        companies_done: i,
      })

      const domain =
        company.domain ||
        extractDomain(company.url) ||
        slugDomainGuess(company.company_name)

      const report: Record<string, unknown> = {
        name: company.company_name,
        domain,
        hiring_signal: company.hiring_signal || null,
        relevance: company.relevance || 0,
        source: company.source,
        by_provider: { hunter: 0, websearch: 0, proxycurl: 0 },
        kept: 0,
        outcome: '',
      }

      if (!domain) {
        report.outcome = 'Skipped — could not resolve domain'
        company_reports.push(report)
        continue
      }

      if (!isEmployerCorporateHost(domain)) {
        report.outcome = 'Skipped — domain is a publisher/aggregator, not an employer'
        company_reports.push(report)
        continue
      }

      let hunterPeople: Candidate[] = []
      let hunterOrg: string | null = null

      const [hunterResult, webPeople, proxyPeople] = await Promise.all([
        hunterKey && hunterEnabled && !hunterState.quotaExhausted
          ? searchHunter(domain, source_stats.hunter, hunterState)
          : Promise.resolve({ people: [] as Candidate[], organization: null }),
        webConfigured
          ? searchWebLinkedIn(
              company.company_name,
              domain,
              peopleTitles,
              source_stats.websearch,
              deptKeywords,
            )
          : Promise.resolve([] as Candidate[]),
        proxyKey
          ? searchProxycurl(
              domain,
              company.company_name,
              peopleTitles,
              source_stats.proxycurl,
            )
          : Promise.resolve([] as Candidate[]),
      ])
      hunterPeople = hunterResult.people
      hunterOrg = hunterResult.organization

      const canonicalName = pickCanonicalCompanyName(
        company.company_name,
        domain,
        hunterOrg,
      )

      if (!looksLikeEmployerName(canonicalName)) {
        report.outcome = 'Skipped — could not resolve a real employer name'
        company_reports.push(report)
        continue
      }

      report.name = canonicalName

      let companyId: string | null = null
      const { data: existingCompany } = await admin
        .from('companies')
        .select('*')
        .eq('user_id', user.id)
        .eq('domain', domain)
        .maybeSingle()

      if (existingCompany) {
        companyId = existingCompany.id
        await admin
          .from('companies')
          .update({
            hiring_signal_source: company.source,
            hiring_signal_url: company.url,
            hiring_signal_title: company.hiring_signal || null,
            name: canonicalName,
          })
          .eq('id', companyId)
      } else {
        const { data: inserted, error: insErr } = await admin
          .from('companies')
          .insert({
            user_id: user.id,
            name: canonicalName,
            domain,
            hiring_signal_source: company.source,
            hiring_signal_url: company.url,
            hiring_signal_title: company.hiring_signal || null,
          })
          .select('*')
          .single()
        if (insErr || !inserted) {
          report.outcome = `DB error — ${insErr?.message || 'insert failed'}`
          errors.push(`${canonicalName}: ${insErr?.message}`)
          company_reports.push(report)
          continue
        }
        companyId = inserted.id
      }
      companiesSelected += 1

      await setProgress(admin, runId, {
        message: `Scored ${canonicalName}: H${hunterPeople.length} / Web${webPeople.length} / P${proxyPeople.length}`,
        detail: `Domain ${domain}`,
        current_company: canonicalName,
      })

      ;(report.by_provider as Record<string, number>).hunter = hunterPeople.length
      ;(report.by_provider as Record<string, number>).websearch = webPeople.length
      ;(report.by_provider as Record<string, number>).proxycurl = proxyPeople.length

      await setProgress(admin, runId, {
        message: `${canonicalName}: scoring & emails…`,
        detail: hunterEnabled && !hunterState.quotaExhausted
          ? 'Outreach title score + Hunter / OSINT emails'
          : 'Outreach title score + OSINT email pipeline',
        current_company: canonicalName,
      })

      const merged = new Map<string, Candidate>()
      for (const c of [...hunterPeople, ...webPeople, ...proxyPeople]) {
        const key = dedupeKey(c, domain)
        const prev = merged.get(key)
        merged.set(key, prev ? mergeCandidate(prev, c) : c)
      }

      const peopleForOsint = [...merged.values()]
        .filter((c) => c.first_name && c.last_name)
        .slice(0, 20)
        .map((c) => ({
          first_name: c.first_name!,
          last_name: c.last_name!,
        }))

      source_stats.osint.attempted += 1
      const osintBundle = await enrichCompanyOsint(domain, peopleForOsint)
      source_stats.osint.people_found += osintBundle.seedEmails.length
      for (const err of osintBundle.errors) {
        if (err) source_stats.osint.errors.push(err)
      }

      const rankedPeople: Array<{
        cand: Candidate
        score: number
        match: { ok: boolean; reason: string }
      }> = []

      for (const cand of merged.values()) {
        const match = titleMatchesFilters(cand.title, include, exclude)
        if (!match.ok && match.reason.startsWith('excluded')) continue

        const outreachScore = scoreOutreachTitle(cand.title)
        const includeBonus = match.ok ? 3 : 0
        const totalScore = outreachScore + includeBonus
        const webOnlyLoose =
          totalScore < 5 &&
          cand.sources.includes('websearch') &&
          !cand.title &&
          Boolean(cand.linkedin_url) &&
          Boolean(cand.first_name)

        if (totalScore < 5 && !match.ok && !webOnlyLoose) continue

        rankedPeople.push({
          cand,
          score: totalScore + (webOnlyLoose ? 5 : 0),
          match,
        })
      }

      rankedPeople.sort((a, b) => b.score - a.score)

      let kept = 0
      let skippedDup = 0
      for (const { cand, score, match } of rankedPeople) {
        if (kept >= maxPerCompany) break

        if (contactAlreadyKnown(cand, companyId, contactIndex)) {
          skippedDup += 1
          contactsSkippedDuplicate += 1
          continue
        }

        for (const s of cand.sources) {
          if (source_stats[s]) source_stats[s].after_title_filter += 1
        }

        if (!cand.email && cand.first_name && cand.last_name) {
          if (
            hunterKey &&
            hunterEnabled &&
            !hunterState.quotaExhausted
          ) {
            const found = await hunterEmailFinder(
              domain,
              cand.first_name,
              cand.last_name,
              hunterState,
            )
            if (found?.email) {
              cand.email = found.email
              cand.verification_status =
                found.verification_status || cand.verification_status
              if (!cand.sources.includes('hunter')) {
                cand.sources.push('hunter')
              }
              cand.source_details.hunter_email = {
                via: 'email-finder',
                domain,
              }
            }
          }

          if (!cand.email) {
            source_stats.osint.after_title_filter += 1
            const osint = await discoverPersonEmailOsint(
              domain,
              cand.first_name,
              cand.last_name,
              osintBundle,
            )
            if (osint.email) {
              cand.email = osint.email
              cand.verification_status =
                osint.verification_status || cand.verification_status
              for (const s of osint.sources) {
                if (!cand.sources.includes(s)) cand.sources.push(s)
              }
              cand.source_details = {
                ...cand.source_details,
                ...osint.source_details,
              }
              for (const s of osint.sources) {
                if (source_stats[s]) {
                  source_stats[s].people_found += 1
                } else if (source_stats.osint) {
                  source_stats.osint.people_found += 1
                }
              }
            }
          }
        }

        if (cand.email) {
          for (const s of cand.sources) {
            if (source_stats[s]) source_stats[s].with_email += 1
          }
          if (
            cand.sources.some((s) =>
              ['site_crawl', 'pattern', 'verify_mx', 'osint_worker'].includes(s)
            )
          ) {
            source_stats.osint.with_email += 1
          }
        }

        if (!cand.email) continue

        if (contactAlreadyKnown(cand, companyId, contactIndex)) {
          skippedDup += 1
          contactsSkippedDuplicate += 1
          continue
        }

        if (filters.require_verified_email !== false) {
          const hunterPrimary =
            hunterEnabled &&
            !hunterState.quotaExhausted &&
            cand.sources.includes('hunter') &&
            Boolean(hunterKey)

          if (hunterPrimary) {
            const verified = await hunterEmailVerifier(cand.email, hunterState)
            if (verified) cand.verification_status = verified
          }
          if (
            cand.first_name &&
            cand.last_name &&
            (!hunterPrimary ||
              !passesEmailVerification(
                cand.verification_status,
                true,
                filters.accept_accept_all !== false,
              ))
          ) {
            const fin = await finalizeOsintEmail(
              cand.email,
              osintBundle,
              cand.first_name,
              cand.last_name,
            )
            cand.verification_status =
              fin.verification_status || cand.verification_status
            cand.source_details = {
              ...cand.source_details,
              osint_verify: fin.source_details,
            }
          }

          if (
            !passesEmailVerification(
              cand.verification_status,
              true,
              filters.accept_accept_all !== false,
            )
          ) {
            continue
          }
        }

        const primary =
          cand.sources.find((s) => s !== 'verify_mx') || cand.sources[0] || 'osint'
        const signal = company.hiring_signal || 'industry-targeted (no public job)'
        const reason = `${
          match.ok
            ? match.reason
            : `outreach score ${score} (${cand.title || 'websearch'})`
        }; signal: ${signal}; found via ${cand.sources.join(' + ')}`

        const { error: contactErr } = await admin.from('contacts').insert({
          user_id: user.id,
          company_id: companyId,
          first_name: cand.first_name,
          last_name: cand.last_name,
          full_name: cand.full_name,
          title: cand.title,
          email: cand.email,
          linkedin_url: cand.linkedin_url,
          verification_status: cand.verification_status,
          filter_match_reason: reason,
          discovery_source: primary,
          sources: cand.sources,
          review_status: 'pending',
          source_details: {
            ...cand.source_details,
            hiring_signal: company.hiring_signal || null,
            hiring_signal_url: company.url,
            job_source: company.source,
            outreach_score: score,
          },
        })

        if (!contactErr) {
          kept += 1
          contactsCreated += 1
          registerContactInIndex(contactIndex, cand, companyId)
          for (const s of cand.sources) {
            if (source_stats[s]) source_stats[s].contacts_kept += 1
          }
          if (
            cand.sources.some((s) =>
              ['site_crawl', 'pattern', 'verify_mx', 'osint_worker'].includes(s)
            )
          ) {
            source_stats.osint.contacts_kept += 1
          }
        }
      }

      report.kept = kept
      if (skippedDup > 0) {
        ;(report as Record<string, unknown>).skipped_duplicate = skippedDup
      }
      report.outcome =
        kept > 0
          ? `Kept ${kept} contact(s)${skippedDup ? ` · ${skippedDup} already on file` : ''}`
          : `No contacts kept (H${hunterPeople.length}/W${webPeople.length}/P${proxyPeople.length}${skippedDup ? ` · ${skippedDup} dup` : ''})`
      company_reports.push(report)

      await setProgress(admin, runId, {
        companies_done: i + 1,
        detail: `${company.company_name}: kept ${kept} · total contacts ${contactsCreated}`,
        current_company: company.company_name,
      })
    }

    await setProgress(admin, runId, {
      stage: 'finishing',
      progress: 95,
      message: 'Building search report…',
      current_company: null,
    })

    if (hunterState.quotaExhausted && hunterState.quotaNote) {
      source_stats.hunter.note = hunterState.quotaNote
    }

    const how = {
      method:
        'Industry company discovery (Serper/Bing) → rank by profile fit → optional job-board signals → LinkedIn people (web search) → emails via OSINT (site crawl + pattern) with optional Hunter when enabled.',
      company_queries: companyQueries,
      job_queries: jobQueries,
      location: location || null,
      sources: {
        web_company: {
          used: webConfigured,
          companies: webCompanies.length,
          searches: company_discovery_stats.attempted,
          note: webConfigured
            ? null
            : 'Set SERPER_API_KEY or BING_SEARCH_API_KEY for industry company discovery',
        },
        remotive: { used: true, jobs: remotiveCount },
        adzuna: {
          used: Boolean(Deno.env.get('ADZUNA_APP_ID')),
          jobs: adzunaCount,
          note: Deno.env.get('ADZUNA_APP_ID') ? null : 'Not configured',
        },
      },
      include_titles: include,
      exclude_titles: exclude,
      people_search_titles: peopleTitles,
      department_keywords: deptKeywords.slice(0, 8),
      require_verified_email: filters.require_verified_email !== false,
      enable_hunter: hunterEnabled,
      hunter_quota_exhausted: hunterState.quotaExhausted,
      max_companies_per_run: maxCompanies,
      max_contacts_per_company: maxPerCompany,
      profile_roles: targetRoles,
      profile_industries: industries,
      profile_company_types: companyTypes.slice(0, 8),
      profile_outreach_targets: outreachTargets.slice(0, 10),
      profile_skills: skills.slice(0, 8),
      unique_companies_from_jobs: byCompany.size,
      companies_attempted: selected.length,
      companies_ranked_by_fit: selected.map((c) => ({
        name: c.company_name,
        hiring_for: c.hiring_signal || null,
        relevance: c.relevance || 0,
        source: c.source,
      })),
      note_apollo: 'Apollo removed — use Serper/Bing + Hunter instead.',
      known_contacts_before_run: contactIndex.total,
    }

    if (await runWasCancelled(admin, runId)) {
      return jsonResponse({ ok: false, run_id: runId, cancelled: true })
    }

    const summary = {
      jobs_scanned: allJobs.length,
      companies_discovered: webCompanies.length,
      companies_selected: companiesSelected,
      contacts_created: contactsCreated,
      contacts_skipped_duplicate: contactsSkippedDuplicate,
      how,
      source_stats,
      company_reports,
      errors: [
        ...errors,
        ...company_discovery_stats.errors,
        ...Object.entries(source_stats).flatMap(([name, s]) =>
          s.errors.map((e) => `${name}: ${e}`),
        ),
      ],
      diagnosis:
        contactsCreated === 0
          ? diagnose(
              source_stats,
              webCompanies.length,
              allJobs.length,
              include,
              webConfigured,
            )
          : null,
    }

    await setProgress(admin, runId, {
      status: 'done',
      stage: 'done',
      progress: 100,
      message:
        contactsCreated > 0
          ? `Done — ${contactsCreated} contact(s) from ${companiesSelected} companies`
          : `Done — no contacts kept (${webCompanies.length} industry cos · ${allJobs.length} jobs)`,
      detail: null,
      current_company: null,
      companies_done: selected.length,
      summary,
      error: null,
    })

    return jsonResponse({ ok: true, run_id: runId, summary })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error'
    if (runId) {
      await setProgress(admin, runId, {
        status: 'failed',
        stage: 'failed',
        progress: 100,
        message: 'Search failed',
        error: msg,
      })
    }
    return errorResponse(msg, 500)
  }
})

function diagnose(
  stats: Record<string, SourceStats>,
  industryCompanies: number,
  jobs: number,
  include: string[],
  webConfigured: boolean,
): string {
  if (!webConfigured && industryCompanies === 0 && jobs === 0) {
    return 'Add SERPER_API_KEY or BING_SEARCH_API_KEY to discover industry-aligned companies.'
  }
  if (industryCompanies === 0 && jobs === 0) {
    return 'No companies matched your industries or job queries — broaden profile industries or roles.'
  }
  if (!webConfigured) {
    return 'Add SERPER_API_KEY for industry company discovery and LinkedIn people search. Hunter alone is capped at 10 emails/domain.'
  }
  const after =
    (stats.hunter?.after_title_filter || 0) +
    (stats.websearch?.after_title_filter || 0) +
    (stats.proxycurl?.after_title_filter || 0) +
    (stats.osint?.after_title_filter || 0)
  if (after === 0) {
    return `People found, but none scored above outreach threshold (includes: ${include.slice(0, 4).join(', ') || 'none'}). Widen Filters or lower seniority bar.`
  }
  return 'People matched but emails failed find/verify. Try disabling "Require verified email" or enable Hunter in Filters.'
}
