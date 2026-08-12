/**
 * Resolve a company's official website / email domain via OpenAI.
 * Prefer this over naive web-search hits (which often pick lookalike sites).
 */
import { openaiChat } from './cors.ts'
import { isEmployerCorporateHost } from './company_discovery.ts'

export type CompanyDomainResolution = {
  domain: string | null
  email_domain: string | null
  url: string | null
  confidence: 'high' | 'medium' | 'low'
  source: 'openai' | 'none'
}

const cache = new Map<string, CompanyDomainResolution>()

function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.trim().toLowerCase()
  d = d.replace(/^mailto:/, '').replace(/^@/, '')
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0]?.split('?')[0]?.split('#')[0] || ''
  if (!d || !d.includes('.')) return null
  if (!isEmployerCorporateHost(d)) return null
  return d
}

/** True when the domain's registrable label roughly matches the company name. */
export function domainLooksLikeCompany(
  companyName: string,
  domain: string | null | undefined,
): boolean {
  if (!domain) return false
  const n = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const label = domain
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')[0]
    ?.replace(/[^a-z0-9]+/g, '') || ''
  if (!n || !label || label.length < 2) return false
  if (n === label) return true
  if (n.includes(label) && label.length >= 4) return true
  if (label.includes(n) && n.length >= 4) return true
  // Soft prefix (SpaceX vs spacex) already covered; reject spacex vs spacecrew
  const shorter = n.length <= label.length ? n : label
  const longer = n.length <= label.length ? label : n
  if (shorter.length >= 5 && longer.startsWith(shorter)) return true
  return false
}

function parseResolution(raw: string): CompanyDomainResolution {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) {
      return {
        domain: null,
        email_domain: null,
        url: null,
        confidence: 'low',
        source: 'none',
      }
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >
    const domain = normalizeHost(
      typeof parsed.domain === 'string' ? parsed.domain : null,
    )
    const emailDomain = normalizeHost(
      typeof parsed.email_domain === 'string'
        ? parsed.email_domain
        : typeof parsed.emailDomain === 'string'
          ? parsed.emailDomain
          : domain,
    )
    let url =
      typeof parsed.url === 'string' && parsed.url.trim()
        ? parsed.url.trim()
        : null
    if (url) {
      try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`)
        url = u.toString()
      } catch {
        url = domain ? `https://${domain}` : null
      }
    } else if (domain) {
      url = `https://${domain}`
    }
    const confRaw = String(parsed.confidence || 'medium').toLowerCase()
    const confidence: CompanyDomainResolution['confidence'] =
      confRaw === 'high' || confRaw === 'low' ? confRaw : 'medium'
    return {
      domain,
      email_domain: emailDomain || domain,
      url,
      confidence: domain ? confidence : 'low',
      source: domain ? 'openai' : 'none',
    }
  } catch {
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
    }
  }
}

/**
 * Ask OpenAI for the official website domain and common @email domain.
 * Example: SpaceX → spacex.com / @spacex.com (not lookalike job boards).
 */
export async function resolveCompanyDomainWithAi(
  companyName: string,
  opts?: { hintDomain?: string | null },
): Promise<CompanyDomainResolution> {
  const name = companyName.trim()
  if (!name) {
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
    }
  }

  const cacheKey = `${name.toLowerCase()}|${(opts?.hintDomain || '').toLowerCase()}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  if (!Deno.env.get('OPENAI_API_KEY')) {
    const empty: CompanyDomainResolution = {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
    }
    cache.set(cacheKey, empty)
    return empty
  }

  const hint = opts?.hintDomain?.trim()
  const prompt = `What is the official primary website domain and the most common employee email @domain for this company?

Company name: ${name}
${hint ? `Hint (may be wrong — verify): ${hint}` : ''}

Return JSON only:
{"domain":"example.com","email_domain":"example.com","url":"https://www.example.com","confidence":"high"}

Rules:
- domain = official corporate website host (no www), e.g. SpaceX → spacex.com, Google → google.com.
- email_domain = what appears after @ on typical employee emails (often the same as domain).
- NEVER use job boards, recruiting agencies, news sites, Wikipedia, LinkedIn, Crunchbase, or similarly named unrelated companies (e.g. do not confuse SpaceX with SpaceCrew or other lookalikes).
- If you are not reasonably sure, set confidence to "low" and still give the best-known official domain when the company is well-known.
- No markdown, no commentary.`

  try {
    const raw = await openaiChat(
      [
        {
          role: 'system',
          content:
            'You resolve official company website and email domains. Return valid JSON only. Prefer well-known corporate domains; reject lookalikes.',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: 0, response_format: { type: 'json_object' } },
    )
    const resolved = parseResolution(raw)
    cache.set(cacheKey, resolved)
    return resolved
  } catch {
    const empty: CompanyDomainResolution = {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
    }
    cache.set(cacheKey, empty)
    return empty
  }
}

/**
 * Pick the best domain: prefer OpenAI when confident or when the current
 * candidate does not look like the company name.
 */
export async function pickCompanyDomain(opts: {
  companyName: string
  currentDomain?: string | null
  currentUrl?: string | null
}): Promise<{
  domain: string | null
  email_domain: string | null
  url: string | null
  source: string
}> {
  const current = normalizeHost(opts.currentDomain || null)
  const ai = await resolveCompanyDomainWithAi(opts.companyName, {
    hintDomain: current,
  })

  const currentOk =
    current &&
    isEmployerCorporateHost(current) &&
    domainLooksLikeCompany(opts.companyName, current)

  if (ai.domain && isEmployerCorporateHost(ai.domain)) {
    const aiOk = domainLooksLikeCompany(opts.companyName, ai.domain)
    if (
      ai.confidence === 'high' ||
      ai.confidence === 'medium' ||
      (aiOk && !currentOk) ||
      !currentOk
    ) {
      return {
        domain: ai.domain,
        email_domain: ai.email_domain || ai.domain,
        url: ai.url || `https://${ai.domain}`,
        source: 'openai',
      }
    }
  }

  if (currentOk && current) {
    return {
      domain: current,
      email_domain: current,
      url: opts.currentUrl || `https://${current}`,
      source: 'existing',
    }
  }

  if (ai.domain && isEmployerCorporateHost(ai.domain)) {
    return {
      domain: ai.domain,
      email_domain: ai.email_domain || ai.domain,
      url: ai.url || `https://${ai.domain}`,
      source: 'openai',
    }
  }

  return {
    domain: current,
    email_domain: current,
    url: opts.currentUrl || (current ? `https://${current}` : null),
    source: current ? 'existing' : 'none',
  }
}
