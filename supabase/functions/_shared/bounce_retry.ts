/**
 * After a guessed address bounces, try the next name-pattern (up to 5 total).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { generateEmailCandidates } from './email_discovery.ts'
import { sendOutreachMime } from './outreach_send.ts'

export const MAX_GUESS_ATTEMPTS = 5

export type BounceRetryState = {
  tried_emails: string[]
  max_attempts: number
  last_bounce_at?: string
  last_bounce_summary?: string | null
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

export function isGuessedContactEmail(opts: {
  sources?: string[] | null
  source_details?: Record<string, unknown> | null
}): boolean {
  const details = opts.source_details || {}
  const prov = asRecord(details.email_provenance)
  if (prov.method === 'guessed') return true
  if (prov.method === 'found') return false
  const sources = opts.sources || []
  if (sources.includes('pattern')) return true
  // Pattern assembly without other public sources
  const hasFound =
    sources.includes('apollo') ||
    sources.includes('hunter') ||
    sources.includes('tomba') ||
    sources.includes('site_crawl') ||
    sources.includes('web_snippet') ||
    sources.includes('osint_worker')
  return !hasFound && Boolean(asRecord(details.pattern)?.inferred)
}

function splitName(contact: {
  first_name?: string | null
  last_name?: string | null
  full_name?: string | null
}): { first: string; last: string } {
  const first = (contact.first_name || '').trim()
  const last = (contact.last_name || '').trim()
  if (first && last) return { first, last }
  const parts = (contact.full_name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (parts.length >= 2) {
    return { first: parts[0], last: parts[parts.length - 1] }
  }
  return { first: first || parts[0] || '', last: last || '' }
}

function emailDomain(email: string): string | null {
  const d = email.trim().toLowerCase().split('@')[1]
  return d || null
}

function readRetryState(
  sourceDetails: Record<string, unknown>,
): BounceRetryState {
  const raw = asRecord(sourceDetails.bounce_retry)
  const tried = Array.isArray(raw.tried_emails)
    ? raw.tried_emails
        .filter((e): e is string => typeof e === 'string')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    : []
  return {
    tried_emails: [...new Set(tried)],
    max_attempts:
      typeof raw.max_attempts === 'number' && raw.max_attempts > 0
        ? raw.max_attempts
        : MAX_GUESS_ATTEMPTS,
    last_bounce_at:
      typeof raw.last_bounce_at === 'string' ? raw.last_bounce_at : undefined,
    last_bounce_summary:
      typeof raw.last_bounce_summary === 'string'
        ? raw.last_bounce_summary
        : null,
  }
}

export function nextGuessEmail(opts: {
  first: string
  last: string
  domain: string
  triedEmails: string[]
  inferredPattern?: string | null
}): string | null {
  const tried = new Set(
    opts.triedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean),
  )
  const candidates = generateEmailCandidates(
    opts.first,
    opts.last,
    opts.domain,
    opts.inferredPattern || null,
    12,
  )
  for (const email of candidates) {
    if (!tried.has(email.toLowerCase())) return email.toLowerCase()
  }
  return null
}

export type GuessRetryResult =
  | { action: 'retried'; attempt: number; from: string; to: string }
  | { action: 'exhausted'; tried: string[] }
  | { action: 'not_guessed' }
  | { action: 'skipped'; reason: string }

/**
 * If the bounced contact email was pattern-guessed, try the next pattern and
 * resend. Stays on pending. Gives up after MAX_GUESS_ATTEMPTS distinct addresses.
 */
export async function maybeRetryGuessedEmailAfterBounce(opts: {
  admin: SupabaseClient
  userId: string
  draft: {
    id: string
    subject: string
    body: string
    contact_id: string
  }
  bounceSummary: string | null
  /** Thread that showed the bounce — skip if draft already moved to a new thread. */
  bouncedThreadId?: string | null
}): Promise<GuessRetryResult> {
  const { admin, userId, draft, bounceSummary, bouncedThreadId } = opts

  const { data: liveDraft } = await admin
    .from('outreach_drafts')
    .select('status, gmail_thread_id')
    .eq('id', draft.id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!liveDraft || liveDraft.status !== 'pending') {
    return { action: 'skipped', reason: 'not_pending' }
  }
  if (
    bouncedThreadId &&
    liveDraft.gmail_thread_id &&
    liveDraft.gmail_thread_id !== bouncedThreadId
  ) {
    return { action: 'skipped', reason: 'already_retried' }
  }

  const { data: contact, error: contactErr } = await admin
    .from('contacts')
    .select(
      'id, email, first_name, last_name, full_name, sources, source_details, companies(domain)',
    )
    .eq('id', draft.contact_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (contactErr || !contact) {
    return { action: 'skipped', reason: 'contact_not_found' }
  }

  const sourceDetails = asRecord(contact.source_details)
  const sources = Array.isArray(contact.sources)
    ? (contact.sources as string[])
    : []

  if (!isGuessedContactEmail({ sources, source_details: sourceDetails })) {
    return { action: 'not_guessed' }
  }

  const currentEmail = (contact.email || '').trim().toLowerCase()
  if (!currentEmail) {
    return { action: 'skipped', reason: 'no_email' }
  }

  const retry = readRetryState(sourceDetails)
  const tried = [...retry.tried_emails]
  if (!tried.includes(currentEmail)) tried.push(currentEmail)

  if (tried.length >= retry.max_attempts) {
    return { action: 'exhausted', tried }
  }

  const { first, last } = splitName(contact)
  if (!first || !last) {
    return { action: 'skipped', reason: 'missing_name' }
  }

  const companies = contact.companies as
    | { domain?: string | null }
    | { domain?: string | null }[]
    | null
  const company = Array.isArray(companies) ? companies[0] : companies
  const domain =
    emailDomain(currentEmail) ||
    (company?.domain || '').toLowerCase().replace(/^www\./, '') ||
    null
  if (!domain) {
    return { action: 'skipped', reason: 'missing_domain' }
  }

  const patternDetail = asRecord(sourceDetails.pattern)
  const inferred =
    typeof patternDetail.inferred === 'string' ? patternDetail.inferred : null
  const prov = asRecord(sourceDetails.email_provenance)
  const provPattern =
    typeof prov.pattern === 'string' ? prov.pattern : null

  const next = nextGuessEmail({
    first,
    last,
    domain,
    triedEmails: tried,
    inferredPattern: inferred || provPattern,
  })

  if (!next) {
    return { action: 'exhausted', tried }
  }

  // Send next guess first — only mutate contact/draft if Gmail accepts it
  let sendResult
  try {
    sendResult = await sendOutreachMime({
      admin,
      userId,
      to: next,
      subject: draft.subject,
      body: draft.body,
    })
  } catch (e) {
    return {
      action: 'skipped',
      reason: e instanceof Error ? e.message : 'resend_failed',
    }
  }

  const attempt = tried.length + 1
  const nextTried = [...tried, next]
  const nextDetails = {
    ...sourceDetails,
    bounce_retry: {
      tried_emails: nextTried,
      max_attempts: retry.max_attempts,
      last_bounce_at: new Date().toISOString(),
      last_bounce_summary: bounceSummary,
      current_attempt: attempt,
    } satisfies BounceRetryState & { current_attempt: number },
    email_provenance: {
      ...prov,
      method: 'guessed',
      origin: prov.origin || 'pattern',
      pattern: inferred || provPattern,
      label: `Guessed · retry ${attempt}/${retry.max_attempts}`,
      detail: `Retry after bounce — attempt ${attempt}/${retry.max_attempts} (${next})`,
    },
  }

  await admin
    .from('contacts')
    .update({
      email: next,
      verification_status: 'unknown',
      source_details: nextDetails,
    })
    .eq('id', contact.id)
    .eq('user_id', userId)

  await admin
    .from('outreach_drafts')
    .update({
      status: 'pending',
      sent_at: new Date().toISOString(),
      error_message: `Guessed address bounced — trying ${next} (${attempt}/${retry.max_attempts}).`,
      gmail_message_id: sendResult.gmail_id,
      gmail_thread_id: sendResult.gmail_thread_id,
      bounce_detected_at: null,
      bounce_summary: bounceSummary
        ? `Prior bounce: ${bounceSummary}. Now trying ${next}.`
        : `Prior address bounced. Now trying ${next}.`,
    })
    .eq('id', draft.id)
    .eq('user_id', userId)

  return {
    action: 'retried',
    attempt,
    from: currentEmail,
    to: next,
  }
}

/** Seed bounce_retry.tried_emails on first send when the address was guessed. */
export async function recordInitialGuessAttempt(opts: {
  admin: SupabaseClient
  userId: string
  contactId: string
  email: string
}): Promise<void> {
  const { admin, userId, contactId, email } = opts
  const { data: contact } = await admin
    .from('contacts')
    .select('sources, source_details')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle()
  if (!contact) return

  const sourceDetails = asRecord(contact.source_details)
  const sources = Array.isArray(contact.sources)
    ? (contact.sources as string[])
    : []
  if (!isGuessedContactEmail({ sources, source_details: sourceDetails })) return

  const retry = readRetryState(sourceDetails)
  const normalized = email.trim().toLowerCase()
  if (!normalized) return
  if (retry.tried_emails.includes(normalized)) return

  await admin
    .from('contacts')
    .update({
      source_details: {
        ...sourceDetails,
        bounce_retry: {
          tried_emails: [...retry.tried_emails, normalized],
          max_attempts: MAX_GUESS_ATTEMPTS,
          current_attempt: 1,
        },
      },
    })
    .eq('id', contactId)
    .eq('user_id', userId)
}
