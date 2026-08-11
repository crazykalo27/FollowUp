/** Apollo.io People Enrichment — email + profile data for a known person. */

export type ApolloEnrichResult = {
  email: string | null
  title: string | null
  linkedin_url: string | null
  location: string | null
  verification_status: string | null
  headline: string | null
  apollo_id: string | null
}

function formatApolloLocation(person: Record<string, unknown>): string | null {
  const parts = [person.city, person.state, person.country].filter(
    (p) => typeof p === 'string' && p.trim(),
  ) as string[]
  return parts.length ? parts.join(', ') : null
}

/** Map Apollo email_status to Hunter-compatible verification labels where possible. */
export function mapApolloEmailStatus(status: string | null | undefined): string | null {
  if (!status) return null
  const s = status.toLowerCase()
  if (s === 'verified') return 'valid'
  if (s === 'guessed' || s === 'unavailable') return 'unknown'
  return status
}

/**
 * Enrich one person via POST /api/v1/people/match.
 * Consumes Apollo credits when email or demographics are returned.
 */
export async function apolloEnrichPerson(
  domain: string,
  first_name: string,
  last_name: string,
  opts?: {
    linkedin_url?: string | null
    company_name?: string | null
  },
): Promise<ApolloEnrichResult | null> {
  const key = Deno.env.get('APOLLO_API_KEY')
  if (!key) return null

  const url = new URL('https://api.apollo.io/api/v1/people/match')
  url.searchParams.set('first_name', first_name)
  url.searchParams.set('last_name', last_name)
  url.searchParams.set('domain', domain)
  url.searchParams.set('reveal_personal_emails', 'true')
  if (opts?.linkedin_url?.trim()) {
    url.searchParams.set('linkedin_url', opts.linkedin_url.trim())
  }
  if (opts?.company_name?.trim()) {
    url.searchParams.set('organization_name', opts.company_name.trim())
  }

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': key,
    },
    signal: AbortSignal.timeout(12_000),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg =
      (body as { error?: string })?.error ||
      (body as { message?: string })?.message ||
      `Apollo ${res.status}`
    throw new Error(msg)
  }

  const person = (body as { person?: Record<string, unknown> })?.person
  if (!person || typeof person !== 'object') return null

  return {
    email: typeof person.email === 'string' ? person.email : null,
    title: typeof person.title === 'string' ? person.title : null,
    linkedin_url:
      typeof person.linkedin_url === 'string' ? person.linkedin_url : null,
    location: formatApolloLocation(person),
    verification_status: mapApolloEmailStatus(
      typeof person.email_status === 'string' ? person.email_status : null,
    ),
    headline: typeof person.headline === 'string' ? person.headline : null,
    apollo_id: typeof person.id === 'string' ? person.id : null,
  }
}
