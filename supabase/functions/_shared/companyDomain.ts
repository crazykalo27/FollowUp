/**
 * Resolve a company's official website / email domain via OpenAI.
 * This is the only domain resolution method — no slug guesses, web-search
 * lookalikes, or per-company hardcodes.
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
 * Works for any company — no hardcoded domain map.
 */
export async function resolveCompanyDomainWithAi(
  companyName: string,
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

  const cacheKey = name.toLowerCase()
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

  const prompt = `What is the official primary website domain and the most common employee email @domain for this company?

Company name: ${name}

Return JSON only:
{"domain":"example.com","email_domain":"example.com","url":"https://www.example.com","confidence":"high"}

Rules:
- domain = official corporate website host (no www), e.g. SpaceX → spacex.com, Google → google.com, Meta → meta.com.
- email_domain = what appears after @ on typical employee emails (often the same as domain; sometimes different, e.g. Alphabet employees @google.com).
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
 * Resolve company domain via OpenAI only — no slug/web/existing fallbacks.
 */
export async function pickCompanyDomain(opts: {
  companyName: string
}): Promise<{
  domain: string | null
  email_domain: string | null
  url: string | null
  source: string
  confidence: 'high' | 'medium' | 'low'
}> {
  const ai = await resolveCompanyDomainWithAi(opts.companyName)
  if (ai.domain && isEmployerCorporateHost(ai.domain)) {
    return {
      domain: ai.domain,
      email_domain: ai.email_domain || ai.domain,
      url: ai.url || `https://${ai.domain}`,
      source: 'openai',
      confidence: ai.confidence,
    }
  }
  return {
    domain: null,
    email_domain: null,
    url: null,
    source: 'none',
    confidence: 'low',
  }
}
