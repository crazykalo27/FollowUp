/** AI-led company discovery: profile + filters → live web search → real employers. */

import {
  openaiChatRaw,
  type OpenAiChatMessage,
  type OpenAiToolDef,
} from './cors.ts'

export type CompanySeed = {
  company_name: string
  domain: string | null
  url: string
  source: string
  hiring_signal?: string | null
  relevance?: number
  why?: string | null
}

export type DiscoveryProfile = {
  roles?: string[]
  industries?: string[]
  company_types?: string[]
  outreach_targets?: string[]
  skills?: string[]
  locations?: string[]
  notes?: string
  employment_types?: string[]
  remote_preference?: string
  seniority?: string
  must_haves?: string[]
}

export type DiscoveryFilters = {
  include_titles?: string[]
  exclude_titles?: string[]
  locations?: string[]
  company_size_min?: number | null
  company_size_max?: number | null
  seniority?: string[]
}

export type WebSearchHit = {
  title?: string
  link?: string
  url?: string
  snippet?: string
}

export type DiscoveryStats = {
  attempted: number
  found: number
  errors: string[]
  rounds: number
  queries: string[]
}

export const SKIP_COMPANY_HOST_PARTS = [
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
  'companiesmarketcap.',
  'companiesmarketcap.com',
  'finance.yahoo.',
  'yahoo.com/finance',
  'stockanalysis.com',
  'macrotrends.net',
  'investing.com',
  'marketwatch.com',
  'nasdaq.com/market-activity',
  'fool.com',
  'seekingalpha.com',
  'etf.com',
  'etfdb.com',
  'listful.com',
  'ranking.',
  'top10.',
  'top100.',
  'wellfound.com/jobs',
  'angel.co/jobs',
  'linkedin.com',
]

const LISTICLE_TITLE_RE =
  /\b(top\s*\d+|best\s*\d+|\d+\s+(best|top|leading|largest)|list of|largest\b|market\s*cap|ranking|ranked|fortune\s*500|stock\b|etf\b|newsletter|podcast|webinar|interview with|how to|guide to|what is|ultimate guide|roundup|magazine|weekly|daily digest|blog\b|vs\.|review\b|careers page|job board|companies to watch|to know in)\b/i

export function isSkippableCompanyHost(host: string): boolean {
  const h = host.toLowerCase()
  return SKIP_COMPANY_HOST_PARTS.some((p) => h.includes(p))
}

export function isEmployerCorporateHost(host: string): boolean {
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

export function isListicleOrPublisherTitle(text: string): boolean {
  const t = text.trim()
  if (!t || t.length < 2) return true
  if (LISTICLE_TITLE_RE.test(t)) return true
  if (/^\d{4}\s/.test(t)) return true
  return false
}

export function looksLikeEmployerName(name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || n.length > 80) return false
  if (isListicleOrPublisherTitle(n)) return false
  const lower = n.toLowerCase()
  if (
    /\b(newsletter|blog|magazine|journal|insider|digest|podcast|substack|medium|market\s*cap|ranking|etf|wikipedia|arxiv|paper|proceedings)\b/.test(
      lower,
    )
  ) {
    return false
  }
  if (/^(the|a)\s+\d+/i.test(n)) return false
  return true
}

export function companyDiscoveryRoundBudget(depth: string): number {
  if (depth === 'quick') return 3
  if (depth === 'deep') return 7
  return 5
}

/** @deprecated Prefer AI discovery; kept for report/back-compat. */
export function companyWebSearchQueryBudget(depth: string): number {
  return companyDiscoveryRoundBudget(depth) * 2
}

const WEB_SEARCH_TOOL: OpenAiToolDef = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the live web for real employer companies matching the candidate profile. Prefer queries that surface company websites, LinkedIn company pages, or hiring pages — not blogs, academic papers, or “top N” listicles.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query targeting real employers (e.g. "SiFive RISC-V careers", "site:linkedin.com/company quantum computing startup").',
        },
      },
      required: ['query'],
    },
  },
}

function extractDomainFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
    if (!host || isSkippableCompanyHost(host)) return null
    if (!isEmployerCorporateHost(host)) return null
    return host
  } catch {
    return null
  }
}

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || ''
  if (!d || isSkippableCompanyHost(d)) return null
  if (!isEmployerCorporateHost(d)) return null
  return d
}

function parseCompaniesJson(text: string): Array<{
  company_name?: string
  domain?: string | null
  url?: string | null
  why?: string | null
  hiring_signal?: string | null
}> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1].trim() : trimmed
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      companies?: Array<Record<string, unknown>>
    }
    if (!Array.isArray(parsed.companies)) return []
    return parsed.companies.map((c) => ({
      company_name: typeof c.company_name === 'string' ? c.company_name : undefined,
      domain: typeof c.domain === 'string' ? c.domain : null,
      url: typeof c.url === 'string' ? c.url : null,
      why: typeof c.why === 'string' ? c.why : null,
      hiring_signal:
        typeof c.hiring_signal === 'string' ? c.hiring_signal : null,
    }))
  } catch {
    return []
  }
}

function scoreAiCompany(
  name: string,
  why: string | null,
  profile: DiscoveryProfile,
): number {
  const blob = `${name} ${why || ''}`.toLowerCase()
  let score = 8
  for (const role of profile.roles || []) {
    if (role && blob.includes(role.toLowerCase())) score += 2
  }
  for (const ind of profile.industries || []) {
    if (ind && blob.includes(ind.toLowerCase())) score += 2
  }
  for (const skill of (profile.skills || []).slice(0, 8)) {
    if (skill && blob.includes(skill.toLowerCase())) score += 1
  }
  for (const ct of profile.company_types || []) {
    if (ct && blob.includes(ct.toLowerCase())) score += 1
  }
  return score
}

function sanitizeAiCompanies(
  raw: Array<{
    company_name?: string
    domain?: string | null
    url?: string | null
    why?: string | null
    hiring_signal?: string | null
  }>,
  profile: DiscoveryProfile,
  maxCompanies: number,
): CompanySeed[] {
  const out: CompanySeed[] = []
  const seen = new Set<string>()

  for (const c of raw) {
    const name = (c.company_name || '').trim()
    if (!looksLikeEmployerName(name)) continue

    let domain = normalizeDomain(c.domain || null)
    const urlRaw = (c.url || '').trim()
    const isLinkedInCompany =
      /linkedin\.com\/company\//i.test(urlRaw) ||
      /linkedin\.com\/company\//i.test(c.domain || '')

    if (!domain && urlRaw && !isLinkedInCompany) {
      domain = extractDomainFromUrl(urlRaw)
    }

    // LinkedIn company pages are allowed without a corporate domain
    let url = urlRaw
    if (!url && domain) url = `https://${domain}/`
    if (!url && !domain && !isLinkedInCompany) continue
    if (!url && isLinkedInCompany) {
      // keep whatever LI URL we have; domain stays null until later resolution
      url = urlRaw
    }

    if (url && !isLinkedInCompany) {
      try {
        const host = new URL(url).hostname.toLowerCase()
        if (isSkippableCompanyHost(host) && !domain) continue
      } catch {
        if (!domain) continue
      }
    }

    const key = (domain || name).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    out.push({
      company_name: name,
      domain,
      url: url || (domain ? `https://${domain}/` : ''),
      source: 'ai_web_search',
      hiring_signal: c.hiring_signal || null,
      why: c.why || null,
      relevance: scoreAiCompany(name, c.why || null, profile),
    })
  }

  return out
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
    .slice(0, maxCompanies)
}

function buildDiscoveryBrief(
  profile: DiscoveryProfile,
  filters: DiscoveryFilters,
  maxCompanies: number,
  preferenceHint?: string | null,
): string {
  return JSON.stringify(
    {
      goal: `Find ${maxCompanies} real employers (companies / labs / product orgs) that hire for this candidate. Then we will search for people at those companies in similar roles.`,
      profile: {
        target_roles: profile.roles || [],
        industries: profile.industries || [],
        company_types: profile.company_types || [],
        people_to_contact: profile.outreach_targets || [],
        skills: (profile.skills || []).slice(0, 12),
        locations: profile.locations || [],
        employment_types: profile.employment_types || [],
        remote_preference: profile.remote_preference || null,
        seniority: profile.seniority || null,
        must_haves: profile.must_haves || [],
        notes: profile.notes || null,
      },
      filters: {
        include_titles: filters.include_titles || [],
        exclude_titles: filters.exclude_titles || [],
        locations: filters.locations || [],
        company_size_min: filters.company_size_min ?? null,
        company_size_max: filters.company_size_max ?? null,
        seniority: filters.seniority || [],
      },
      preference_hint: preferenceHint || null,
      reject: [
        'blogs, newsletters, magazines, podcasts',
        'academic papers, arxiv, journals, conference proceedings',
        '“top N companies” listicles and ranking pages',
        'job boards and aggregators (Indeed, Glassdoor, Builtin)',
        'finance ticker / market-cap list pages',
        'generic publishers (TechCrunch, Forbes, etc.) as the employer',
      ],
      output_when_done:
        'Return ONLY JSON: {"companies":[{"company_name":"...","domain":"example.com","url":"https://...","why":"one sentence fit","hiring_signal":"optional role/team"}]}',
    },
    null,
    2,
  )
}

/**
 * Ask the model to run live web searches (via tool) using profile + filters,
 * then return real employer companies.
 */
export async function discoverCompaniesWithAi(
  profile: DiscoveryProfile,
  filters: DiscoveryFilters,
  opts: {
    maxCompanies: number
    depth: string
    runWebSearch: (q: string, num: number) => Promise<WebSearchHit[]>
    onProgress?: (msg: string) => void | Promise<void>
    preferenceHint?: string | null
  },
): Promise<{ companies: CompanySeed[]; stats: DiscoveryStats }> {
  const stats: DiscoveryStats = {
    attempted: 0,
    found: 0,
    errors: [] as string[],
    rounds: 0,
    queries: [] as string[],
  }

  const maxRounds = companyDiscoveryRoundBudget(opts.depth)
  const need = Math.max(3, Math.min(opts.maxCompanies + 4, 14))

  const system = `You are a company discovery agent for job outreach.
Given a candidate profile and search filters, use the web_search tool to find REAL employers that fit — companies, product orgs, or research labs that hire people in the target roles.
Do NOT treat publishers, blogs, academic papers, listicles, or job boards as companies.
Prefer official company sites and LinkedIn company pages.
After enough evidence, stop calling tools and reply with the JSON object described in the user brief.
Return at most ${need} companies, best fits first.`

  const messages: OpenAiChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: buildDiscoveryBrief(
        profile,
        filters,
        need,
        opts.preferenceHint,
      ),
    },
  ]

  for (let round = 0; round < maxRounds; round++) {
    stats.rounds = round + 1
    let message: OpenAiChatMessage
    try {
      message = await openaiChatRaw(messages, {
        temperature: 0.2,
        tools: [WEB_SEARCH_TOOL],
        tool_choice: 'auto',
        model: 'gpt-4o-mini',
      })
    } catch (e) {
      stats.errors.push(
        e instanceof Error ? e.message : 'OpenAI company discovery failed',
      )
      break
    }

    const toolCalls = message.tool_calls || []
    if (toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: toolCalls,
      })

      for (const call of toolCalls) {
        if (call.function?.name !== 'web_search') {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'unknown tool' }),
          })
          continue
        }

        let query = ''
        try {
          const args = JSON.parse(call.function.arguments || '{}') as {
            query?: string
          }
          query = (args.query || '').trim()
        } catch {
          query = ''
        }

        if (!query) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'missing query' }),
          })
          continue
        }

        stats.attempted += 1
        stats.queries.push(query)
        if (opts.onProgress) {
          await opts.onProgress(`AI web search: “${query}”`)
        }

        try {
          const organic = await opts.runWebSearch(query, 8)
          stats.found += organic.length
          const compact = organic.slice(0, 8).map((item) => ({
            title: item.title || null,
            url: item.link || item.url || null,
            snippet: item.snippet || null,
          }))
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ query, results: compact }),
          })
        } catch (e) {
          const err =
            e instanceof Error ? e.message : `Search failed: ${query}`
          stats.errors.push(err)
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ query, error: err, results: [] }),
          })
        }
      }
      continue
    }

    const content = message.content || ''
    const parsed = parseCompaniesJson(content)
    if (parsed.length > 0) {
      const companies = sanitizeAiCompanies(parsed, profile, opts.maxCompanies)
      if (opts.onProgress) {
        await opts.onProgress(
          `AI selected ${companies.length} employer(s) from live search`,
        )
      }
      return { companies, stats }
    }

    // Model replied without tools or parseable JSON — nudge once, then stop
    messages.push({ role: 'assistant', content })
    messages.push({
      role: 'user',
      content:
        'Return the final JSON now with a companies array of real employers only (name, domain, url, why). No markdown commentary.',
    })
  }

  // Final forced JSON pass without tools
  try {
    if (opts.onProgress) await opts.onProgress('AI finalizing company list…')
    const finalMsg = await openaiChatRaw(
      [
        ...messages,
        {
          role: 'user',
          content:
            'Based on the search evidence so far, return ONLY the JSON object with companies. No tools.',
        },
      ],
      {
        temperature: 0.1,
        response_format: { type: 'json_object' },
        tool_choice: 'none',
        model: 'gpt-4o-mini',
      },
    )
    const companies = sanitizeAiCompanies(
      parseCompaniesJson(finalMsg.content || ''),
      profile,
      opts.maxCompanies,
    )
    return { companies, stats }
  } catch (e) {
    stats.errors.push(
      e instanceof Error ? e.message : 'AI company finalize failed',
    )
    return { companies: [], stats }
  }
}

/**
 * Titles used when searching people at discovered companies.
 * Prefer filter include titles + outreach targets + the user's target roles
 * (similar roles), then broad fallbacks.
 */
export function buildPeopleSearchTitles(opts: {
  includeTitles?: string[]
  outreachTargets?: string[]
  targetRoles?: string[]
  broadFallback?: string[]
  limit?: number
}): string[] {
  const broad = opts.broadFallback || [
    'Director',
    'Engineering Manager',
    'Principal Engineer',
    'Staff Engineer',
    'Research Scientist',
    'Senior Engineer',
    'Lead Engineer',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of [
    ...(opts.includeTitles || []),
    ...(opts.outreachTargets || []),
    ...(opts.targetRoles || []),
    ...broad,
  ]) {
    const key = t.toLowerCase().trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(t.trim())
  }
  return out.slice(0, opts.limit ?? 10)
}
