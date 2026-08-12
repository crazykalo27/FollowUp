/**
 * Resolve a company's official website / email domain via OpenAI + live web_search.
 * The model must search (Bing/Serper) before choosing a domain — no memory-only guesses.
 */
import {
  openaiChatRaw,
  type OpenAiChatMessage,
  type OpenAiToolDef,
} from './cors.ts'
import { isEmployerCorporateHost } from './company_discovery.ts'

export type CompanyDomainResolution = {
  domain: string | null
  email_domain: string | null
  url: string | null
  confidence: 'high' | 'medium' | 'low'
  source: 'openai_web_search' | 'openai' | 'none'
  error?: string | null
}

export type DomainWebSearchHit = {
  title?: string
  link?: string
  url?: string
  snippet?: string
}

const cache = new Map<string, CompanyDomainResolution>()

const DOMAIN_WEB_SEARCH_TOOL: OpenAiToolDef = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      "Search the live web for a company's official website. Prefer queries like \"{Company} official website\" or \"{Company} corporate site\". Avoid job boards and lookalike brands.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query that should surface the official company homepage (e.g. "SpaceX official website").',
        },
      },
      required: ['query'],
    },
  },
}

function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = raw.trim().toLowerCase()
  d = d.replace(/^mailto:/, '').replace(/^@/, '')
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0]?.split('?')[0]?.split('#')[0] || ''
  d = d.replace(/^\.+|\.+$/g, '')
  if (!d || !d.includes('.')) return null
  if (!isEmployerCorporateHost(d)) return null
  return d
}

function parseResolution(
  raw: string,
  source: CompanyDomainResolution['source'],
): CompanyDomainResolution {
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
        error: 'AI returned non-JSON domain response',
      }
    }
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >
    const domainRaw =
      (typeof parsed.domain === 'string' && parsed.domain) ||
      (typeof parsed.website === 'string' && parsed.website) ||
      (typeof parsed.official_domain === 'string' && parsed.official_domain) ||
      (typeof parsed.url === 'string' && parsed.url) ||
      null
    const domain = normalizeHost(domainRaw)
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
      source: domain ? source : 'none',
      error: domain
        ? null
        : `AI domain rejected or missing (raw=${String(domainRaw || '').slice(0, 80)})`,
    }
  } catch (e) {
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
      error: e instanceof Error ? e.message : 'Failed to parse AI domain JSON',
    }
  }
}

/**
 * Ask OpenAI to web_search for the official website / email domain, then return JSON.
 */
export async function resolveCompanyDomainWithAi(
  companyName: string,
  opts?: {
    runWebSearch?: (
      q: string,
      num: number,
    ) => Promise<DomainWebSearchHit[]>
  },
): Promise<CompanyDomainResolution> {
  const name = companyName.trim()
  if (!name) {
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
      error: 'Empty company name',
    }
  }

  const cacheKey = name.toLowerCase()
  const cached = cache.get(cacheKey)
  if (cached?.domain) return cached

  if (!Deno.env.get('OPENAI_API_KEY')) {
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
      error: 'OPENAI_API_KEY missing',
    }
  }

  const runWebSearch = opts?.runWebSearch
  if (!runWebSearch) {
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
      error: 'runWebSearch not provided — domain resolve requires live web search',
    }
  }

  const system = `You resolve official company website and employee email domains.
You MUST call the web_search tool before answering — do not rely on memory alone.
Use search results to pick the official corporate site (not lookalikes, job boards, news, Wikipedia, or LinkedIn).
After you have enough live evidence, stop calling tools and return JSON only.`

  const user = `Find the official primary website domain and the most common employee email @domain for this company using web_search.

Company name: ${name}

Suggested first query: "${name} official website"

Return JSON only when done:
{"domain":"example.com","email_domain":"example.com","url":"https://www.example.com","confidence":"high"}

Rules:
- domain = official corporate website host (no www), e.g. SpaceX → spacex.com.
- email_domain = what appears after @ on typical employee emails (often the same as domain).
- Prefer homepage URLs from search results over third-party directories.
- NEVER use job boards, recruiting agencies, news sites, Wikipedia, LinkedIn, Crunchbase, or similarly named unrelated companies.
- If search results conflict, prefer the company's own site and set confidence to "medium" or "low".
- No markdown, no commentary.`

  const messages: OpenAiChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const maxRounds = 3
  let usedSearch = false

  try {
    for (let round = 0; round < maxRounds; round++) {
      const message = await openaiChatRaw(messages, {
        temperature: 0,
        tools: [DOMAIN_WEB_SEARCH_TOOL],
        // Force a search on the first turn so the model cannot skip to memory.
        tool_choice:
          round === 0
            ? {
                type: 'function',
                function: { name: 'web_search' },
              }
            : 'auto',
        model: 'gpt-4o-mini',
      })

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

          usedSearch = true
          try {
            const organic = await runWebSearch(query, 8)
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
      const resolved = parseResolution(
        content,
        usedSearch ? 'openai_web_search' : 'openai',
      )
      if (resolved.domain) {
        cache.set(cacheKey, resolved)
        return resolved
      }

      messages.push({ role: 'assistant', content })
      messages.push({
        role: 'user',
        content:
          'Return the final JSON now with domain, email_domain, url, and confidence based on the search results. No tools.',
      })
    }

    // Final forced JSON pass without tools
    const finalMsg = await openaiChatRaw(
      [
        ...messages,
        {
          role: 'user',
          content:
            'Based on the web_search evidence so far, return ONLY the JSON object. No tools.',
        },
      ],
      {
        temperature: 0,
        response_format: { type: 'json_object' },
        tool_choice: 'none',
        model: 'gpt-4o-mini',
      },
    )
    const resolved = parseResolution(
      finalMsg.content || '',
      usedSearch ? 'openai_web_search' : 'openai',
    )
    if (resolved.domain) cache.set(cacheKey, resolved)
    return resolved
  } catch (e) {
    const message = e instanceof Error ? e.message : 'OpenAI domain call failed'
    console.error('resolveCompanyDomainWithAi', name, message)
    return {
      domain: null,
      email_domain: null,
      url: null,
      confidence: 'low',
      source: 'none',
      error: message,
    }
  }
}

/**
 * Resolve company domain via OpenAI + live web_search only.
 */
export async function pickCompanyDomain(opts: {
  companyName: string
  runWebSearch?: (
    q: string,
    num: number,
  ) => Promise<DomainWebSearchHit[]>
}): Promise<{
  domain: string | null
  email_domain: string | null
  url: string | null
  source: string
  confidence: 'high' | 'medium' | 'low'
  error?: string | null
}> {
  const ai = await resolveCompanyDomainWithAi(opts.companyName, {
    runWebSearch: opts.runWebSearch,
  })
  if (ai.domain && isEmployerCorporateHost(ai.domain)) {
    return {
      domain: ai.domain,
      email_domain: ai.email_domain || ai.domain,
      url: ai.url || `https://${ai.domain}`,
      source: ai.source,
      confidence: ai.confidence,
      error: null,
    }
  }
  return {
    domain: null,
    email_domain: null,
    url: null,
    source: 'none',
    confidence: 'low',
    error:
      ai.error ||
      (ai.domain
        ? `Rejected host ${ai.domain}`
        : 'AI could not resolve domain from web search'),
  }
}
