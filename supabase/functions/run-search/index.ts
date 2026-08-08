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
import {
  formatProfileLocation,
  parseLocationFromLinkedInSnippet,
  pickBetterLocation,
  looksLikeLocationString,
} from '../_shared/linkedin_location.ts'
import {
  isServiceChainRequest,
  loadPipelineState,
  savePipelineState,
  scheduleSearchContinue,
  type SearchPipelineState,
} from '../_shared/search_queue.ts'
import {
  computeRunProgress,
  initCompaniesProgress,
  loadProgressMeta,
  markCompanyDone,
  markCompanySkipped,
  pushProgressLog,
  saveProgressMeta,
  setCompanyProgress,
  type ProgressMeta,
} from '../_shared/search_progress.ts'
import {
  buildPeopleSearchTitles,
  discoverCompaniesWithAi,
  isEmployerCorporateHost,
  looksLikeEmployerName,
} from '../_shared/company_discovery.ts'

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
  company_size_min?: number | null
  company_size_max?: number | null
  seniority?: string[]
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

function peopleSearchTitles(
  include: string[],
  outreachTargets: string[] = [],
  targetRoles: string[] = [],
): string[] {
  return buildPeopleSearchTitles({
    includeTitles: include,
    outreachTargets,
    targetRoles,
    broadFallback: BROAD_PEOPLE_TITLES,
    limit: 10,
  })
}

async function runWebSearch(
  q: string,
  num: number,
  opts?: { preferBing?: boolean },
): Promise<Array<{ title?: string; link?: string; url?: string; snippet?: string }>> {
  const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
  const serperKey = Deno.env.get('SERPER_API_KEY')
  if (!bingKey && !serperKey) return []

  const useBing = Boolean(bingKey && (opts?.preferBing || !serperKey))

  if (!useBing && serperKey) {
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
      source:
        prev.source === 'ai_web_search' || c.source === 'ai_web_search'
          ? 'ai_web_search'
          : prev.source === 'web_company'
            ? prev.source
            : c.source,
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
  location: string | null
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
    location: pickBetterLocation(into, from),
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

function nameKeysAtCompany(companyId: string, name: string): string[] {
  const n = name.trim().toLowerCase()
  if (!n) return []
  const keys = [`${companyId}:${n}`]
  const parts = n.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    keys.push(`${companyId}:${parts[0]}:${parts[parts.length - 1]}`)
  }
  return keys
}

function candidateNameKeysAtCompany(
  companyId: string,
  cand: Candidate,
): string[] {
  const keys = new Set<string>()
  for (const n of [
    contactDisplayName(cand),
    cand.first_name && cand.last_name
      ? `${cand.first_name} ${cand.last_name}`
      : '',
  ]) {
    for (const k of nameKeysAtCompany(companyId, n)) keys.add(k)
  }
  return [...keys]
}

function registerContactNamesAtCompany(
  index: ContactIndex,
  companyId: string,
  cand: Candidate,
) {
  for (const k of candidateNameKeysAtCompany(companyId, cand)) {
    index.nameAtCompany.add(k)
  }
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
    if (name && row.company_id) {
      for (const k of nameKeysAtCompany(row.company_id, name)) {
        nameAtCompany.add(k)
      }
    }
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
  for (const key of candidateNameKeysAtCompany(companyId, cand)) {
    if (index.nameAtCompany.has(key)) return true
  }
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
  registerContactNamesAtCompany(index, companyId, cand)
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

function companyNameMatchesTarget(companyName: string, target: string): boolean {
  const a = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const b = target.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

async function resolveUserTargetCompany(
  rawName: string,
  webConfigured: boolean,
): Promise<CompanyHit> {
  const company_name = rawName.trim()
  let domain: string | null = slugDomainGuess(company_name)
  let url = domain ? `https://${domain}` : ''

  if (webConfigured) {
    try {
      const hits = await runWebSearch(
        `"${company_name}" company official site OR careers`,
        6,
        { preferBing: true },
      )
      for (const item of hits) {
        const link = item.link || item.url
        if (!link) continue
        if (/linkedin\.com\/company\//i.test(link)) {
          if (!url) url = link
          continue
        }
        const d = extractDomain(link)
        if (d && isEmployerCorporateHost(d)) {
          domain = d
          url = link
          break
        }
      }
    } catch {
      // keep slug guess
    }
  }

  if (!url && domain) url = `https://${domain}`
  if (!url) url = 'https://example.com'

  return {
    company_name,
    domain,
    url,
    source: 'user_target',
    hiring_signal: 'You chose this employer to follow up after applying.',
    relevance: 12,
  }
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
        location: null,
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
  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': key },
    signal: AbortSignal.timeout(10_000),
  })
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

async function fetchProxycurlProfileLocation(
  linkedinUrl: string,
): Promise<string | null> {
  const key = Deno.env.get('PROXYCURL_API_KEY')
  if (!key) return null
  try {
    const url = new URL('https://nubela.co/proxycurl/api/linkedin')
    url.searchParams.set('url', linkedinUrl)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return null
    const body = await res.json()
    return formatProfileLocation(body)
  } catch {
    return null
  }
}

async function backfillLinkedInLocations(
  candidates: Iterable<Candidate>,
  maxProfiles: number,
): Promise<void> {
  if (!Deno.env.get('PROXYCURL_API_KEY')) return
  const need = [...candidates]
    .filter(
      (c) =>
        c.linkedin_url &&
        !c.location?.trim() &&
        !c.sources.includes('proxycurl'),
    )
    .slice(0, maxProfiles)
  await Promise.all(
    need.map(async (c) => {
      const loc = await fetchProxycurlProfileLocation(c.linkedin_url!)
      if (!loc) return
      c.location = loc
      c.sources = [...new Set([...c.sources, 'proxycurl'])]
      c.source_details = {
        ...c.source_details,
        proxycurl: {
          ...(typeof c.source_details?.proxycurl === 'object'
            ? (c.source_details.proxycurl as Record<string, unknown>)
            : {}),
          via: 'v2/linkedin',
          location: loc,
        },
      }
    }),
  )
}

function parseLinkedInTitle(title: string, companyName: string): {
  full_name: string | null
  person_title: string | null
  location: string | null
} {
  // Typical: "Jane Doe - Engineering Manager - Acme | LinkedIn"
  // Or: "Jane Doe - Engineering Manager - Acme - San Francisco Bay Area | LinkedIn"
  const cleaned = title
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
  const parts = cleaned.split(/\s[-–—]\s/).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) {
    return { full_name: null, person_title: null, location: null }
  }

  const full_name = parts[0] || null
  let person_title: string | null = null
  let location: string | null = null
  const companyLower = companyName.toLowerCase()

  for (let i = 1; i < parts.length; i++) {
    const segment = parts[i]
    if (segment.toLowerCase() === companyLower) continue
    if (!person_title) {
      person_title = segment
      continue
    }
    if (looksLikeLocationString(segment)) {
      location = segment
      break
    }
  }
  return { full_name, person_title, location }
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
  searchRound = 0,
): Promise<Candidate[]> {
  const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
  const serperKey = Deno.env.get('SERPER_API_KEY')
  if (!bingKey && !serperKey) return []

  stats.attempted += 1
  let titleList = titles
  if (searchRound === 1) {
    titleList = [...titles.slice(0, 4), ...BROAD_PEOPLE_TITLES.slice(0, 5)]
  } else if (searchRound >= 2) {
    titleList = [
      ...titles.slice(0, 3),
      'Technical Recruiter',
      'Talent Acquisition',
      'Recruiting Manager',
      ...BROAD_PEOPLE_TITLES.slice(0, 4),
    ]
  }
  const titleClause = titleList
    .slice(0, 8)
    .map((t) => `"${t}"`)
    .join(' OR ')
  const deptClause = deptKeywords
    .slice(0, 4)
    .map((k) => `"${k}"`)
    .join(' OR ')

  // Prefer similar role titles at the company; dept keywords only as a secondary query.
  const queries = [
    titleClause
      ? `site:linkedin.com/in (${titleClause}) "${companyName}"`
      : null,
    deptClause
      ? `site:linkedin.com/in "${companyName}" (${deptClause})`
      : null,
  ].filter(Boolean) as string[]

  if (queries.length === 0) {
    queries.push(`site:linkedin.com/in "${companyName}"`)
  }
  if (searchRound >= 1) {
    queries.push(
      `site:linkedin.com/in "${companyName}" (manager OR director OR lead)`,
    )
  }
  if (searchRound >= 2) {
    queries.push(
      `site:linkedin.com/in "${companyName}" (recruiter OR "talent acquisition")`,
    )
  }

  try {
    const out: Candidate[] = []
    const seen = new Set<string>()
    const preferBing = Boolean(bingKey)
    const via = preferBing ? 'bing' : 'serper'
    const maxQueries = searchRound >= 2 ? 3 : 2

    for (const q of queries.slice(0, maxQueries)) {
      const organic = await runWebSearch(q, 6, { preferBing })
      for (const item of organic) {
        const link = item.link || item.url || ''
        const li = extractLinkedInUrl(link)
        if (!li || seen.has(li)) continue
        seen.add(li)
        const parsed = parseLinkedInTitle(item.title || '', companyName)
        const snippet = item.snippet || ''
        const location =
          [parsed.location, parseLocationFromLinkedInSnippet(snippet)].find(
            (l) => l && looksLikeLocationString(l),
          ) || null
        const names = splitName(parsed.full_name)
        out.push({
          first_name: names.first_name,
          last_name: names.last_name,
          full_name: parsed.full_name,
          title: parsed.person_title,
          email: null,
          linkedin_url: li,
          location,
          verification_status: null,
          sources: ['websearch'],
          source_details: {
            websearch: {
              via,
              query: q,
              domain,
              snippet: snippet || null,
              location,
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
        city?: string
        state?: string
        country?: string
        country_full_name?: string
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
        location: formatProfileLocation(profile),
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
    pipeline_state?: unknown | null
    progress_meta?: ProgressMeta
  },
) {
  if (!runId) return
  if (await runWasCancelled(admin, runId)) return
  await admin
    .from('search_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId)
}

async function syncProgress(
  admin: ReturnType<typeof adminClient>,
  runId: string | null,
  meta: ProgressMeta,
  patch: {
    stage?: string
    progress?: number
    message?: string
    detail?: string | null
    current_company?: string | null
    companies_total?: number
    companies_done?: number
    logLine?: string
    companyName?: string
    companyStep?: string
    companyProgress?: number
    companyStatus?: 'pending' | 'active' | 'done' | 'skipped'
  },
) {
  if (patch.logLine) pushProgressLog(meta, patch.logLine)
  if (patch.companyName) {
    setCompanyProgress(meta, patch.companyName, {
      ...(patch.companyStatus ? { status: patch.companyStatus } : {}),
      ...(patch.companyStep ? { step: patch.companyStep } : {}),
      ...(patch.companyProgress !== undefined
        ? { step_progress: patch.companyProgress }
        : {}),
    })
  }
  const { logLine, companyName, companyStep, companyProgress, companyStatus, ...rest } =
    patch
  await setProgress(admin, runId, { ...rest, progress_meta: meta })
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
  const RUN_BUDGET_MS = Math.min(
    400_000,
    Math.max(60_000, Number(Deno.env.get('RUN_SEARCH_BUDGET_MS')) || 140_000),
  )

  const overRunBudget = () => Date.now() - runStartedMs > RUN_BUDGET_MS

  try {
    const body = await req.json().catch(() => ({}))
    runId = typeof body.run_id === 'string' ? body.run_id : null
    const depth = (body.depth as string) || 'standard'
    const searchModeInput =
      body.search_mode === 'company' ? 'company' : 'general'
    const targetCompanyInput =
      typeof body.target_company === 'string' ? body.target_company.trim() : ''
    const companyPeopleRaw = Number(body.company_people_target)
    const companyPeopleTargetInput =
      searchModeInput === 'company' &&
      (companyPeopleRaw === 1 || companyPeopleRaw === 2 || companyPeopleRaw === 5)
        ? companyPeopleRaw
        : null
    const chain = body.chain === true && isServiceChainRequest(req)
    const continueRun =
      body.continue_run === true && !chain && Boolean(runId)

    let user: { id: string }
    if (chain) {
      if (!runId) return errorResponse('run_id required', 400)
      const { data: runRow } = await admin
        .from('search_runs')
        .select('user_id, status')
        .eq('id', runId)
        .maybeSingle()
      if (!runRow || runRow.status !== 'running') {
        return jsonResponse({ ok: true, run_id: runId, skipped: true })
      }
      user = { id: runRow.user_id }
    } else if (continueRun) {
      const auth = await requireUser(req)
      if (auth instanceof Response) return auth
      user = auth.user
      const { data: runRow } = await admin
        .from('search_runs')
        .select('user_id, status')
        .eq('id', runId)
        .maybeSingle()
      if (!runRow || runRow.user_id !== user.id) {
        return errorResponse('Invalid search run', 403)
      }
      if (runRow.status !== 'running') {
        return jsonResponse({ ok: true, run_id: runId, skipped: true })
      }
    } else {
      const auth = await requireUser(req)
      if (auth instanceof Response) return auth
      user = auth.user
    }

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

    const runMain = async () => {
      try {
    let progressMeta = await loadProgressMeta(admin, runId!)
    await syncProgress(admin, runId, progressMeta, {
      stage: 'loading_profile',
      progress: 8,
      message: 'Loading your profile and filters…',
      logLine: 'Reading profile, filters, and API keys',
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
      notes?: string
      employment_types?: string[]
      remote_preference?: string
      seniority?: string
      must_haves?: string[]
    }
    const filters = (filterRow?.filters || {}) as Filters
    const include = filters.include_titles || []
    const exclude = filters.exclude_titles || []
    let maxCompanies = Math.min(
      caps.companies,
      filters.max_companies_per_run || caps.companies,
      10,
    )
    let maxPerCompany = Math.min(
      caps.per,
      filters.max_contacts_per_company || caps.per,
      5,
    )

    let searchMode: 'general' | 'company' = searchModeInput
    let targetCompanyName = targetCompanyInput

    if (searchMode === 'company') {
      maxCompanies = 1
      if (companyPeopleTargetInput) {
        maxPerCompany = companyPeopleTargetInput
      }
    }

    await syncProgress(admin, runId, progressMeta, {
      detail:
        searchMode === 'company'
          ? `Specific company · ${targetCompanyName || '—'} · up to ${maxPerCompany} contacts`
          : `Depth: ${depth} · up to ${maxCompanies} companies × ${maxPerCompany} contacts`,
      logLine:
        searchMode === 'company'
          ? `Target employer: ${targetCompanyName || '(missing name)'}`
          : `Search depth: ${depth} · max ${maxCompanies} companies`,
    })

    const hunterKey = Deno.env.get('HUNTER_API_KEY')
    const proxyKey = Deno.env.get('PROXYCURL_API_KEY')
    const bingKey = Deno.env.get('BING_SEARCH_API_KEY')
    const serperKey = Deno.env.get('SERPER_API_KEY')
    const webConfigured = Boolean(bingKey || serperKey)
    const hunterEnabled = filters.enable_hunter === true
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
          : 'Site crawl, sitemap hints, ≤1 Bing/Serper email query/company, patterns',
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
    const deptKeywords = departmentKeywords(
      industries,
      companyTypes,
      outreachTargets,
      skills,
      targetRoles,
    )
    const peopleTitles = peopleSearchTitles(
      include,
      outreachTargets,
      targetRoles,
    )
    const company_discovery_stats = {
      attempted: 0,
      found: 0,
      errors: [] as string[],
      rounds: 0,
      queries: [] as string[],
    }
    const location =
      (filters.locations && filters.locations[0]) ||
      (profile.locations && profile.locations[0]) ||
      ''

    let pipeline = await loadPipelineState(admin, runId!)
    let selected: CompanyHit[]
    let contactsCreated: number
    let contactsSkippedDuplicate: number
    let companiesSelected: number
    let company_reports: Array<Record<string, unknown>> = []
    let errors: string[] = []
    let webCompaniesLen = 0
    let allJobsLen = 0
    let remotiveCount = 0
    let adzunaCount = 0
    let jobQueriesForReport: string[] = jobQueries
    let companyQueriesForReport: string[] = []

    let justPlanned = false

    if (pipeline) {
      selected = pipeline.selected as CompanyHit[]
      contactsCreated = pipeline.contactsCreated
      contactsSkippedDuplicate = pipeline.contactsSkippedDuplicate
      companiesSelected = pipeline.companiesSelected
      company_reports.push(...pipeline.company_reports)
      errors.push(...pipeline.errors)
      hunterState.quotaExhausted = pipeline.hunterState.quotaExhausted
      hunterState.quotaNote = pipeline.hunterState.quotaNote
      for (const [k, v] of Object.entries(pipeline.source_stats)) {
        source_stats[k] = { ...source_stats[k], ...v } as SourceStats
      }
      webCompaniesLen = pipeline.plan_meta.webCompanies
      allJobsLen = pipeline.plan_meta.allJobs
      remotiveCount = pipeline.plan_meta.remotiveCount
      adzunaCount = pipeline.plan_meta.adzunaCount
      jobQueriesForReport = pipeline.plan_meta.jobQueries
      companyQueriesForReport = pipeline.plan_meta.companyQueries
      if (pipeline.plan_meta.search_mode) {
        searchMode = pipeline.plan_meta.search_mode
        targetCompanyName = pipeline.plan_meta.target_company || ''
      }
      if (progressMeta.companies.length === 0) {
        progressMeta.companies = initCompaniesProgress(
          selected.map((c) => c.company_name),
        )
      }
      await syncProgress(admin, runId, progressMeta, {
        stage: 'searching_people',
        message: `Resuming search (company ${pipeline.company_index + 1} of ${selected.length})…`,
        companies_total: selected.length,
        companies_done: pipeline.company_index,
        progress: computeRunProgress(
          progressMeta,
          pipeline.company_index,
          25,
        ),
        logLine: `Resuming company ${pipeline.company_index + 1} of ${selected.length}`,
      })
    } else {
    let mergedCompanies: CompanyHit[]
    let allJobs: JobHit[] = []
    let webCompanies: CompanyHit[] = []

    if (searchMode === 'company') {
      if (!targetCompanyName) {
        throw new Error('Company name is required for a specific-company search.')
      }
      await syncProgress(admin, runId, progressMeta, {
        stage: 'discovering_companies',
        progress: 14,
        message: `Looking up ${targetCompanyName}…`,
        detail:
          'Skipping industry-wide discovery — you named this employer for post-application follow-up.',
        logLine: `Specific company search: ${targetCompanyName}`,
      })

      const targetHit = await resolveUserTargetCompany(
        targetCompanyName,
        webConfigured,
      )
      companyQueriesForReport = [`Specific company: ${targetCompanyName}`]
      pushProgressLog(
        progressMeta,
        `Resolved target employer ${targetHit.company_name}${
          targetHit.domain ? ` (${targetHit.domain})` : ''
        }`,
      )
      await saveProgressMeta(admin, runId!, progressMeta)

      await syncProgress(admin, runId, progressMeta, {
        stage: 'fetching_jobs',
        progress: 18,
        message: `Checking hiring signals at ${targetCompanyName}…`,
        detail: 'Optional job-board scan for a relevant role title',
        logLine: `Job boards filtered to ${targetCompanyName}`,
      })

      const jobBatches = await Promise.all(
        jobQueries.slice(0, 2).map(async (q) => {
          const combined = `${targetCompanyName} ${q}`.slice(0, 120)
          const [remotive, adzuna] = await Promise.all([
            fetchRemotiveJobs(combined),
            fetchAdzunaJobs(combined, location),
          ])
          return [...remotive, ...adzuna]
        }),
      )
      allJobs = jobBatches
        .flat()
        .filter((j) => companyNameMatchesTarget(j.company_name, targetCompanyName))
      remotiveCount = allJobs.filter((j) => j.source === 'remotive').length
      adzunaCount = allJobs.filter((j) => j.source === 'adzuna').length
      allJobsLen = allJobs.length

      if (allJobs.length > 0) {
        const best = [...allJobs].sort(
          (a, b) =>
            scoreJobRelevance(b.title, targetRoles, industries, skills) -
            scoreJobRelevance(a.title, targetRoles, industries, skills),
        )[0]
        if (best?.title) targetHit.hiring_signal = best.title
        if (!targetHit.domain && best?.candidate_domain) {
          targetHit.domain = best.candidate_domain
        }
      }

      webCompaniesLen = 0
      mergedCompanies = [targetHit]
    } else {
    await syncProgress(admin, runId, progressMeta, {
      stage: 'discovering_companies',
      progress: 12,
      message: 'AI is searching the web for employers from your profile…',
      detail: `Roles: ${(targetRoles.slice(0, 3).join(', ') || 'n/a')}${
        industries.length ? ` · ${industries.slice(0, 2).join(', ')}` : ''
      }`,
      logLine: 'AI company discovery (profile + filters → live web search)',
    })

    const { data: prefRow } = await admin
      .from('preference_documents')
      .select('ai_summary, likes_doc, dislikes_doc')
      .eq('user_id', user.id)
      .maybeSingle()

    const preferenceHint = [
      prefRow?.ai_summary
        ? `Pick-signal preferences: ${prefRow.ai_summary}`
        : null,
      prefRow?.likes_doc
        ? `Rewarded pick signals: ${String(prefRow.likes_doc).slice(0, 400)}`
        : null,
      prefRow?.dislikes_doc
        ? `Rejected pick signals: ${String(prefRow.dislikes_doc).slice(0, 400)}`
        : null,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 900)

    let aiCompanies: CompanyHit[] = []
    if (Deno.env.get('OPENAI_API_KEY')) {
      try {
        const aiResult = await discoverCompaniesWithAi(
          {
            roles: targetRoles,
            industries,
            company_types: companyTypes,
            outreach_targets: outreachTargets,
            skills,
            locations: profile.locations || [],
            notes: profile.notes,
            employment_types: profile.employment_types,
            remote_preference: profile.remote_preference,
            seniority: profile.seniority,
            must_haves: profile.must_haves,
          },
          {
            include_titles: include,
            exclude_titles: exclude,
            locations: filters.locations || [],
            company_size_min: filters.company_size_min,
            company_size_max: filters.company_size_max,
            seniority: filters.seniority,
          },
          {
            maxCompanies: Math.max(maxCompanies + 2, maxCompanies),
            depth,
            runWebSearch: (q, num) => runWebSearch(q, num),
            preferenceHint: preferenceHint || null,
            onProgress: async (msg) => {
              pushProgressLog(progressMeta, msg)
              await saveProgressMeta(admin, runId!, progressMeta)
              await syncProgress(admin, runId, progressMeta, {
                stage: 'discovering_companies',
                progress: 14,
                message: 'AI searching for matching employers…',
                detail: msg,
              })
            },
          },
        )
        aiCompanies = aiResult.companies as CompanyHit[]
        company_discovery_stats.attempted = aiResult.stats.attempted
        company_discovery_stats.found = aiResult.stats.found
        company_discovery_stats.errors = aiResult.stats.errors
        company_discovery_stats.rounds = aiResult.stats.rounds
        company_discovery_stats.queries = aiResult.stats.queries
        companyQueriesForReport = aiResult.stats.queries
      } catch (e) {
        company_discovery_stats.errors.push(
          e instanceof Error ? e.message : 'AI company discovery failed',
        )
      }
    } else {
      company_discovery_stats.errors.push(
        'OPENAI_API_KEY missing — skipping AI company discovery',
      )
    }

    const webCompaniesDiscovered = aiCompanies
    webCompanies = webCompaniesDiscovered

    if (webCompanies.length > 0) {
      pushProgressLog(
        progressMeta,
        `AI discovery: ${webCompanies.length} employers (${company_discovery_stats.attempted} web searches)`,
      )
      await saveProgressMeta(admin, runId!, progressMeta)
    }

    await syncProgress(admin, runId, progressMeta, {
      stage: 'fetching_jobs',
      progress: 18,
      message: 'Supplementing with job-board hiring signals…',
      detail: `Job queries: ${jobQueries
        .slice(0, 2)
        .map((q) => `“${q}”`)
        .join(', ')}${jobQueries.length > 2 ? '…' : ''}`,
      logLine: `Scanning Remotive + Adzuna (${jobQueries.length} role queries)`,
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
    allJobs = jobBatches.flat()
    remotiveCount = allJobs.filter((j) => j.source === 'remotive').length
    adzunaCount = allJobs.filter((j) => j.source === 'adzuna').length

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
    mergedCompanies = mergeCompanyLists(webCompanies, jobCompanies)
    }

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
      if (c.domain && !isEmployerCorporateHost(c.domain)) return false
      if (!c.domain && c.url) {
        try {
          const host = new URL(c.url).hostname.replace(/^www\./, '').toLowerCase()
          if (host.includes('linkedin.com')) {
            return /\/company\//i.test(c.url)
          }
          if (host && !isEmployerCorporateHost(host)) return false
        } catch {
          return true
        }
      }
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
        (c.source === 'ai_web_search' || c.source === 'web_company' ? 5 : 0) +
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
    const selectedRanked = ranked.slice(0, maxCompanies)
    selected = selectedRanked

    if (searchMode !== 'company') {
      webCompaniesLen = webCompanies.length
    }
    allJobsLen = allJobs.length
    contactsCreated = 0
    contactsSkippedDuplicate = 0
    companiesSelected = 0

    const { data: knownContactRows } = await admin
      .from('contacts')
      .select(
        'email, linkedin_url, full_name, first_name, last_name, company_id, review_status',
      )
      .eq('user_id', user.id)

    const contactIndexPlan = buildContactIndex(knownContactRows || [])

    await syncProgress(admin, runId, progressMeta, {
      detail: `${contactIndexPlan.total} known contact(s) on file — duplicates skipped`,
      logLine: `Dedup index: ${contactIndexPlan.total} existing contacts`,
    })

    progressMeta.companies = initCompaniesProgress(
      selected.map((c) => c.company_name),
    )
    pushProgressLog(
      progressMeta,
      `Ranked ${selected.length} target companies`,
    )

    await syncProgress(admin, runId, progressMeta, {
      stage: 'companies_ready',
      progress: computeRunProgress(progressMeta, 0, 25),
      message:
        searchMode === 'company'
          ? `Target employer ready — ${selected[0]?.company_name || targetCompanyName}`
          : `${webCompaniesLen} AI-found companies + ${allJobsLen} jobs → ${selected.length} ranked targets`,
      detail: `Top: ${selected
        .slice(0, 3)
        .map((c) => `${c.company_name} (${c.relevance || 0})`)
        .join(' · ') || 'none'}`,
      companies_total: selected.length,
      companies_done: 0,
      logLine: 'Company queue ready — processing one at a time',
    })

    pipeline = {
      version: 1,
      depth,
      selected: selectedRanked,
      company_index: 0,
      contactsCreated: 0,
      contactsSkippedDuplicate: 0,
      companiesSelected: 0,
      company_reports: [],
      errors: [],
      source_stats: source_stats as SearchPipelineState['source_stats'],
      hunterState: { ...hunterState },
      plan_meta: {
        webCompanies: webCompaniesLen,
        allJobs: allJobsLen,
        remotiveCount,
        adzunaCount,
        jobQueries: jobQueriesForReport,
        companyQueries: companyQueriesForReport,
        company_discovery_stats,
        peopleTitles,
        deptKeywords,
        targetRoles,
        industries,
        companyTypes,
        outreachTargets,
        skills,
        location,
        webConfigured,
        hunterEnabled,
        include,
        exclude,
        maxCompanies,
        maxPerCompany,
        require_verified_email: filters.require_verified_email === true,
        accept_accept_all: filters.accept_accept_all !== false,
        search_mode: searchMode,
        target_company: searchMode === 'company' ? targetCompanyName : null,
        company_people_target:
          searchMode === 'company'
            ? companyPeopleTargetInput ?? maxPerCompany
            : undefined,
      },
    }
    await savePipelineState(admin, runId!, pipeline)
    justPlanned = true
    } // end initial plan

    const meta = pipeline!.plan_meta
    const peopleTitlesRun = meta.peopleTitles
    const deptKeywordsRun = meta.deptKeywords
    const includeRun = meta.include
    const excludeRun = meta.exclude

    if (justPlanned) {
      pushProgressLog(progressMeta, 'Plan saved — scheduling first company')
      await syncProgress(admin, runId, progressMeta, {
        stage: 'searching_people',
        progress: computeRunProgress(progressMeta, 0, 28),
        message: `Plan ready — ${selected.length} companies queued`,
        detail: 'Processing one company at a time in the background',
        companies_total: selected.length,
        companies_done: 0,
      })
      scheduleSearchContinue(admin, runId!, depth)
      return
    }

    const { data: knownContactRowsChunk } = await admin
      .from('contacts')
      .select(
        'email, linkedin_url, full_name, first_name, last_name, company_id, review_status',
      )
      .eq('user_id', user.id)

    const contactIndex = buildContactIndex(knownContactRowsChunk || [])

    const chunkStart = pipeline!.company_index
    const chunkEnd = Math.min(chunkStart + 1, selected.length)
    let companyRoundComplete = true

    for (let i = chunkStart; i < chunkEnd; i++) {
      if (await runWasCancelled(admin, runId)) {
        break
      }

      const company = selected[i]
      const pct = computeRunProgress(progressMeta, i, 25)
      const peopleGoal =
        meta.search_mode === 'company'
          ? meta.company_people_target ?? meta.maxPerCompany
          : meta.maxPerCompany
      const webSearchRound = pipeline!.company_attempt ?? 0
      const skipCompanySetup =
        Boolean(pipeline!.company_ctx) &&
        webSearchRound > 0 &&
        pipeline!.company_ctx!.companyKey === company.company_name
      const companyKeptSoFar = pipeline!.company_kept_total ?? 0

      if (!skipCompanySetup) {
        pipeline!.company_find_failures = 0
        pipeline!.company_attempt = 0
        pipeline!.company_kept_total = 0
        pipeline!.tried_candidate_keys = []
        pipeline!.company_ctx = null
      }

      await syncProgress(admin, runId, progressMeta, {
        stage: 'searching_people',
        progress: pct,
        message: skipCompanySetup
          ? `Retry ${webSearchRound} at ${company.company_name} (${companyKeptSoFar}/${peopleGoal} new people)…`
          : `Searching people at ${company.company_name}…`,
        detail: `Company ${i + 1} of ${selected.length}`,
        current_company: company.company_name,
        companies_total: selected.length,
        companies_done: i,
        companyName: company.company_name,
        companyStatus: 'active',
        companyStep: skipCompanySetup
          ? 'Broader people search (retry)'
          : 'Resolving domain & employer check',
        companyProgress: 8,
        logLine: skipCompanySetup
          ? `${company.company_name}: retry ${webSearchRound} — ${companyKeptSoFar}/${peopleGoal} new so far`
          : `${company.company_name}: company ${i + 1}/${selected.length} — resolving domain`,
      })

      const triedKeys = new Set(pipeline!.tried_candidate_keys ?? [])
      let skippedDup = 0

      let domain: string | null = null
      let companyId: string | null = null
      let canonicalName = company.company_name
      let hunterPeople: Candidate[] = []
      let hunterOrg: string | null = null
      let webPeople: Candidate[] = []
      let proxyPeople: Candidate[] = []

      const report: Record<string, unknown> = skipCompanySetup
        ? (pipeline!.company_reports[pipeline!.company_reports.length - 1] ?? {
            name: company.company_name,
            domain: pipeline!.company_ctx!.domain,
            hiring_signal: company.hiring_signal || null,
            relevance: company.relevance || 0,
            source: company.source,
            by_provider: { hunter: 0, websearch: 0, proxycurl: 0 },
            kept: 0,
            outcome: '',
          })
        : {
            name: company.company_name,
            domain: null as string | null,
            hiring_signal: company.hiring_signal || null,
            relevance: company.relevance || 0,
            source: company.source,
            by_provider: { hunter: 0, websearch: 0, proxycurl: 0 },
            kept: 0,
            outcome: '',
          }

      if (skipCompanySetup && pipeline!.company_ctx) {
        domain = pipeline!.company_ctx.domain
        companyId = pipeline!.company_ctx.companyId
        canonicalName = pipeline!.company_ctx.canonicalName
        report.domain = domain
        report.name = canonicalName
      } else {
      domain =
        company.domain ||
        extractDomain(company.url) ||
        slugDomainGuess(company.company_name)

      report.domain = domain

      if (!domain) {
        report.outcome = 'Skipped — could not resolve domain'
        markCompanySkipped(progressMeta, company.company_name, report.outcome)
        await syncProgress(admin, runId, progressMeta, {
          companies_done: i + 1,
          progress: computeRunProgress(progressMeta, i + 1, 25),
          logLine: `${company.company_name}: ${report.outcome}`,
        })
        company_reports.push(report)
        continue
      }

      if (!isEmployerCorporateHost(domain)) {
        report.outcome = 'Skipped — domain is a publisher/aggregator, not an employer'
        markCompanySkipped(progressMeta, company.company_name, report.outcome)
        await syncProgress(admin, runId, progressMeta, {
          companies_done: i + 1,
          progress: computeRunProgress(progressMeta, i + 1, 25),
          logLine: `${company.company_name}: ${report.outcome}`,
        })
        company_reports.push(report)
        continue
      }

      await syncProgress(admin, runId, progressMeta, {
        companyName: company.company_name,
        companyStep: 'LinkedIn + Hunter domain search (parallel)',
        companyProgress: 22,
        logLine: `${company.company_name}: searching people on ${domain}`,
      })

      const [hunterResult, webHits, proxyHits] = await Promise.all([
        hunterKey && hunterEnabled && !hunterState.quotaExhausted
          ? searchHunter(domain, source_stats.hunter, hunterState)
          : Promise.resolve({ people: [] as Candidate[], organization: null }),
        webConfigured
          ? searchWebLinkedIn(
              company.company_name,
              domain,
              peopleTitlesRun,
              source_stats.websearch,
              deptKeywordsRun,
              webSearchRound,
            )
          : Promise.resolve([] as Candidate[]),
        proxyKey
          ? searchProxycurl(
              domain,
              company.company_name,
              peopleTitlesRun,
              source_stats.proxycurl,
            )
          : Promise.resolve([] as Candidate[]),
      ])
      hunterPeople = hunterResult.people
      hunterOrg = hunterResult.organization
      webPeople = webHits
      proxyPeople = proxyHits

      canonicalName = pickCanonicalCompanyName(
        company.company_name,
        domain,
        hunterOrg,
      )

      if (!looksLikeEmployerName(canonicalName)) {
        report.outcome = 'Skipped — could not resolve a real employer name'
        markCompanySkipped(progressMeta, company.company_name, report.outcome)
        await syncProgress(admin, runId, progressMeta, {
          companies_done: i + 1,
          progress: computeRunProgress(progressMeta, i + 1, 25),
          logLine: `${company.company_name}: ${report.outcome}`,
        })
        company_reports.push(report)
        continue
      }

      report.name = canonicalName

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
          markCompanySkipped(progressMeta, company.company_name, report.outcome)
          await syncProgress(admin, runId, progressMeta, {
            companies_done: i + 1,
            progress: computeRunProgress(progressMeta, i + 1, 25),
            logLine: `${canonicalName}: ${report.outcome}`,
          })
          company_reports.push(report)
          continue
        }
        companyId = inserted.id
      }
      companiesSelected += 1
      pipeline!.company_ctx = {
        domain,
        companyId: companyId!,
        canonicalName,
        companyKey: company.company_name,
      }
      }

      if (!domain || !companyId) {
        report.outcome = 'Skipped — company context missing'
        markCompanySkipped(progressMeta, company.company_name, report.outcome)
        company_reports.push(report)
        continue
      }

      if (skipCompanySetup) {
        await syncProgress(admin, runId, progressMeta, {
          companyName: company.company_name,
          companyStep: 'LinkedIn + broader web search (retry)',
          companyProgress: 22,
          logLine: `${canonicalName}: retry ${webSearchRound} people search`,
        })
        const [webHitsRetry, proxyHitsRetry] = await Promise.all([
          webConfigured
            ? searchWebLinkedIn(
                company.company_name,
                domain,
                peopleTitlesRun,
                source_stats.websearch,
                deptKeywordsRun,
                webSearchRound,
              )
            : Promise.resolve([] as Candidate[]),
          proxyKey
            ? searchProxycurl(
                domain,
                company.company_name,
                peopleTitlesRun,
                source_stats.proxycurl,
              )
            : Promise.resolve([] as Candidate[]),
        ])
        webPeople = webHitsRetry
        proxyPeople = proxyHitsRetry
      }

      await syncProgress(admin, runId, progressMeta, {
        message: `Scored ${canonicalName}: H${hunterPeople.length} / Web${webPeople.length} / P${proxyPeople.length}`,
        detail: `Domain ${domain}`,
        current_company: canonicalName,
        companyName: company.company_name,
        companyStep: `Merged ${hunterPeople.length + webPeople.length + proxyPeople.length} raw hits — ranking titles`,
        companyProgress: 38,
        progress: computeRunProgress(progressMeta, i, 25),
        logLine: `${canonicalName}: H${hunterPeople.length} Hunter · Web${webPeople.length} LinkedIn · P${proxyPeople.length} Proxycurl`,
      })

      ;(report.by_provider as Record<string, number>).hunter = hunterPeople.length
      ;(report.by_provider as Record<string, number>).websearch = webPeople.length
      ;(report.by_provider as Record<string, number>).proxycurl = proxyPeople.length

      await syncProgress(admin, runId, progressMeta, {
        message: `${canonicalName}: scoring & emails…`,
        detail: hunterEnabled && !hunterState.quotaExhausted
          ? 'Outreach title score + Hunter / OSINT emails'
          : 'Outreach title score + OSINT email pipeline',
        current_company: canonicalName,
        companyName: company.company_name,
        companyStep: 'Title fit scoring',
        companyProgress: 42,
      })

      const merged = new Map<string, Candidate>()
      for (const c of [...hunterPeople, ...webPeople, ...proxyPeople]) {
        const key = dedupeKey(c, domain)
        const prev = merged.get(key)
        merged.set(key, prev ? mergeCandidate(prev, c) : c)
      }

      await backfillLinkedInLocations(merged.values(), 5)

      const peopleForOsint = [...merged.values()]
        .filter((c) => {
          if (!c.first_name || !c.last_name) return false
          if (contactAlreadyKnown(c, companyId, contactIndex)) {
            skippedDup += 1
            contactsSkippedDuplicate += 1
            triedKeys.add(dedupeKey(c, domain))
            return false
          }
          return true
        })
        .slice(0, 20)
        .map((c) => ({
          first_name: c.first_name!,
          last_name: c.last_name!,
        }))

      source_stats.osint.attempted += 1
      const osintFast =
        overRunBudget() || Date.now() - runStartedMs > RUN_BUDGET_MS - 45_000
      await syncProgress(admin, runId, progressMeta, {
        message: `${canonicalName}: finding emails (OSINT)…`,
        detail: 'Site crawl + patterns (about 20s max)',
        current_company: canonicalName,
        companyName: company.company_name,
        companyStep: 'OSINT — site crawl, sitemap, patterns',
        companyProgress: 52,
        logLine: `${canonicalName}: OSINT email discovery (≤20s)`,
      })
      const osintBundle = await enrichCompanyOsint(domain, peopleForOsint, {
        fast: osintFast,
        budgetMs: 20_000,
        useWorker: Boolean(Deno.env.get('OSINT_WORKER_URL')),
      })
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
        const match = titleMatchesFilters(cand.title, includeRun, excludeRun)
        if (!match.ok && match.reason.startsWith('excluded')) continue

        if (contactAlreadyKnown(cand, companyId, contactIndex)) {
          skippedDup += 1
          contactsSkippedDuplicate += 1
          triedKeys.add(dedupeKey(cand, domain))
          continue
        }

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

      await syncProgress(admin, runId, progressMeta, {
        companyName: company.company_name,
        companyStep: 'Matching emails to contacts & verification',
        companyProgress: 68,
        logLine: `${canonicalName}: OSINT ${osintBundle.seedEmails.length} seed emails · ${rankedPeople.length} people after title filter`,
      })

      let kept = 0
      for (const { cand, score, match } of rankedPeople) {
        const keptAtCompany = (pipeline!.company_kept_total ?? 0) + kept
        if (keptAtCompany >= peopleGoal) break

        const candKey = dedupeKey(cand, domain)
        if (triedKeys.has(candKey)) continue
        triedKeys.add(candKey)

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
            let osint = {
              email: null as string | null,
              verification_status: null as string | null,
              sources: [] as string[],
              source_details: {} as Record<string, unknown>,
            }
            try {
              osint = await Promise.race([
                discoverPersonEmailOsint(
                  domain,
                  cand.first_name,
                  cand.last_name,
                  osintBundle,
                ),
                new Promise<Awaited<ReturnType<typeof discoverPersonEmailOsint>>>(
                  (resolve) =>
                    setTimeout(
                      () =>
                        resolve({
                          email: null,
                          verification_status: null,
                          sources: [],
                          source_details: { osint_timeout: true },
                        }),
                      9_000,
                    ),
                ),
              ])
            } catch {
              // skip person osint
            }
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
              ['site_crawl', 'pattern', 'verify_mx', 'osint_worker', 'web_snippet'].includes(s)
            )
          ) {
            source_stats.osint.with_email += 1
          }
        }

        if (!cand.email) continue

        if (meta.require_verified_email === true) {
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
                meta.accept_accept_all,
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
              meta.accept_accept_all !== false,
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
          location: cand.location,
          verification_status: cand.verification_status,
          filter_match_reason: reason,
          discovery_source: primary,
          sources: cand.sources,
          review_status: 'pending',
          source_details: {
            ...cand.source_details,
            location: cand.location,
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
              ['site_crawl', 'pattern', 'verify_mx', 'osint_worker', 'web_snippet'].includes(s)
            )
          ) {
            source_stats.osint.contacts_kept += 1
          }
        }
      }
      pipeline!.tried_candidate_keys = [...triedKeys]
      pipeline!.company_kept_total = (pipeline!.company_kept_total ?? 0) + kept
      const companyKept = pipeline!.company_kept_total

      report.kept = companyKept
      if (skippedDup > 0) {
        ;(report as Record<string, unknown>).skipped_duplicate = skippedDup
      }
      companyRoundComplete = true
      if (companyKept < peopleGoal) {
        if (kept > 0) {
          pipeline!.company_find_failures = 0
        } else {
          pipeline!.company_find_failures =
            (pipeline!.company_find_failures ?? 0) + 1
        }
        if (
          companyKept < peopleGoal &&
          (pipeline!.company_find_failures ?? 0) < 3
        ) {
          companyRoundComplete = false
          pipeline!.company_attempt = (pipeline!.company_attempt ?? 0) + 1
          pushProgressLog(
            progressMeta,
            `${canonicalName}: ${companyKept}/${peopleGoal} new — attempt ${pipeline!.company_attempt} (${pipeline!.company_find_failures}/3 empty rounds${skippedDup ? ` · ${skippedDup} dupes skipped` : ''})`,
          )
          report.outcome = `Found ${companyKept}/${peopleGoal} new — scheduling another pass…`
        } else if (companyKept < peopleGoal) {
          report.outcome = `Stopped at ${companyKept}/${peopleGoal} after 3 rounds with no new contacts`
        }
      }

      if (companyRoundComplete) {
        report.outcome =
          companyKept > 0
            ? `Kept ${companyKept}/${peopleGoal} new contact(s)${skippedDup ? ` · ${skippedDup} already on file` : ''}`
            : `No new contacts kept (H${hunterPeople.length}/W${webPeople.length}/P${proxyPeople.length}${skippedDup ? ` · ${skippedDup} dup` : ''})`
        company_reports.push(report)
        markCompanyDone(progressMeta, company.company_name, report.outcome as string)
        pipeline!.company_ctx = null
        pipeline!.tried_candidate_keys = []
        pipeline!.company_attempt = 0
        pipeline!.company_find_failures = 0
      }

      await syncProgress(admin, runId, progressMeta, {
        companies_done: companyRoundComplete ? i + 1 : i,
        progress: computeRunProgress(
          progressMeta,
          companyRoundComplete ? i + 1 : i,
          25,
        ),
        detail: `${company.company_name}: ${report.outcome}`,
        current_company: company.company_name,
        logLine: `${canonicalName}: ${report.outcome}`,
      })
    }

    pipeline!.company_index = !companyRoundComplete ? chunkStart : chunkEnd
    pipeline!.contactsCreated = contactsCreated
    pipeline!.contactsSkippedDuplicate = contactsSkippedDuplicate
    pipeline!.companiesSelected = companiesSelected
    pipeline!.company_reports = company_reports
    pipeline!.errors = errors
    pipeline!.source_stats = source_stats as SearchPipelineState['source_stats']
    pipeline!.hunterState = {
      quotaExhausted: hunterState.quotaExhausted,
      quotaNote: hunterState.quotaNote,
    }
    await savePipelineState(admin, runId!, pipeline!)

    const cancelledAfterChunk = await runWasCancelled(admin, runId)
    if (pipeline!.company_index < selected.length && !cancelledAfterChunk) {
      await syncProgress(admin, runId, progressMeta, {
        stage: 'searching_people',
        message: `Queued company ${pipeline!.company_index + 1} of ${selected.length}…`,
        detail: 'One company per step — continuing in background',
        companies_done: pipeline!.company_index,
        companies_total: selected.length,
        progress: computeRunProgress(
          progressMeta,
          pipeline!.company_index,
          25,
        ),
        logLine: `Queueing company ${pipeline!.company_index + 1} of ${selected.length}`,
      })
      scheduleSearchContinue(admin, runId!, pipeline!.depth || depth)
      return
    }

    await syncProgress(admin, runId, progressMeta, {
      stage: 'finishing',
      progress: 95,
      message: 'Building search report…',
      current_company: null,
      logLine: 'All companies processed — compiling report',
    })

    if (hunterState.quotaExhausted && hunterState.quotaNote) {
      source_stats.hunter.note = hunterState.quotaNote
    }

    const how = {
      method:
        meta.search_mode === 'company'
          ? `Specific-company search for "${meta.target_company || '—'}". Skips industry discovery; finds people at that employer in roles similar to yours (LinkedIn via Bing/Serper → OSINT → optional Hunter) — useful after you applied.`
          : 'Queued search (one company per step). AI reads your profile + filters, runs live web search for employers, then finds people in similar roles at those companies (LinkedIn via Bing/Serper → OSINT → optional Hunter).',
      search_mode: meta.search_mode || 'general',
      target_company: meta.target_company || null,
      company_queries: companyQueriesForReport,
      job_queries: jobQueriesForReport,
      location: meta.location || null,
      sources: {
        web_company: {
          used: Boolean(Deno.env.get('OPENAI_API_KEY')),
          companies: webCompaniesLen,
          searches: meta.company_discovery_stats.attempted,
          note: Deno.env.get('OPENAI_API_KEY')
            ? 'AI agent + Serper/Bing web_search tool'
            : 'Set OPENAI_API_KEY (and SERPER_API_KEY or BING_SEARCH_API_KEY) for AI company discovery',
        },
        remotive: { used: true, jobs: remotiveCount },
        adzuna: {
          used: Boolean(Deno.env.get('ADZUNA_APP_ID')),
          jobs: adzunaCount,
          note: Deno.env.get('ADZUNA_APP_ID') ? null : 'Not configured',
        },
      },
      include_titles: includeRun,
      exclude_titles: excludeRun,
      people_search_titles: peopleTitlesRun,
      department_keywords: deptKeywordsRun.slice(0, 8),
      require_verified_email: meta.require_verified_email,
      enable_hunter: meta.hunterEnabled,
      hunter_quota_exhausted: hunterState.quotaExhausted,
      max_companies_per_run: meta.maxCompanies,
      max_contacts_per_company: meta.maxPerCompany,
      profile_roles: meta.targetRoles,
      profile_industries: meta.industries,
      profile_company_types: meta.companyTypes.slice(0, 8),
      profile_outreach_targets: meta.outreachTargets.slice(0, 10),
      profile_skills: meta.skills.slice(0, 8),
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
      jobs_scanned: allJobsLen,
      companies_discovered: webCompaniesLen,
      companies_selected: companiesSelected,
      contacts_created: contactsCreated,
      contacts_skipped_duplicate: contactsSkippedDuplicate,
      how,
      source_stats,
      company_reports,
      errors: [
        ...errors,
        ...meta.company_discovery_stats.errors,
        ...Object.entries(source_stats).flatMap(([name, s]) =>
          s.errors.map((e) => `${name}: ${e}`),
        ),
      ],
      diagnosis:
        contactsCreated === 0
          ? diagnose(
              source_stats,
              webCompaniesLen,
              allJobsLen,
              includeRun,
              meta.webConfigured,
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
          : `Done — no contacts kept (${webCompaniesLen} industry cos · ${allJobsLen} jobs)`,
      detail: null,
      current_company: null,
      companies_done: selected.length,
      summary,
      error: null,
      pipeline_state: null,
    })
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
      }
    }

    const edgeRuntime = (
      globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }
    ).EdgeRuntime
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(runMain())
      return jsonResponse({ ok: true, run_id: runId, accepted: true }, 202)
    }

    await runMain()
    return jsonResponse({ ok: true, run_id: runId })
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
