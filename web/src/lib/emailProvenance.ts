/** How we obtained a contact email — found vs pattern-guessed + verification. */

export type EmailProvenance = {
  method: 'found' | 'guessed'
  origin:
    | 'apollo'
    | 'hunter'
    | 'site_crawl'
    | 'web_snippet'
    | 'osint_worker'
    | 'pattern'
    | 'unknown'
  pattern: string | null
  verification: 'verified' | 'likely' | 'unverified' | 'unknown'
  verification_status: string | null
  label: string
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

export function buildEmailProvenance(opts: {
  sources?: string[] | null
  verification_status?: string | null
  source_details?: Record<string, unknown> | null
}): EmailProvenance {
  const stored = opts.source_details?.email_provenance as
    | Partial<EmailProvenance>
    | undefined
  if (
    stored &&
    (stored.method === 'found' || stored.method === 'guessed') &&
    typeof stored.detail === 'string' &&
    stored.detail.trim()
  ) {
    return {
      method: stored.method,
      origin: stored.origin || 'unknown',
      pattern: stored.pattern ?? null,
      verification: stored.verification || 'unknown',
      verification_status:
        stored.verification_status ?? opts.verification_status ?? null,
      label: stored.label || (stored.method === 'guessed' ? 'Guessed' : 'Found'),
      detail: stored.detail,
    }
  }

  const sources = opts.sources || []
  const status = opts.verification_status || null
  const details = opts.source_details || {}
  const tier = verificationTier(status)

  const patternDetail = details.pattern as
    | { inferred?: string | null }
    | undefined
  const pattern =
    typeof patternDetail?.inferred === 'string' ? patternDetail.inferred : null

  const hasApollo =
    sources.includes('apollo') || Boolean(details.apollo)
  const hasHunter =
    sources.includes('hunter') ||
    Boolean(details.hunter_email) ||
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
  } else if (hasApollo || details.apollo) {
    method = 'found'
    origin = 'apollo'
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
      apollo: 'Apollo.io',
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
