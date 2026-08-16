/**
 * Live deliverability checks without sending mail.
 * MX on Edge; SMTP RCPT via optional OSINT worker (port 25 blocked on Edge).
 */

import { hunterGet } from './cors.ts'
import { sanitizeOutreachEmail, verifyEmailMx } from './email_discovery.ts'
import { tombaConfigured, tombaEmailVerifier } from './tomba.ts'

export type LiveVerifyResult = {
  verification_status: string
  method_used: 'mx' | 'smtp' | 'hunter' | 'tomba'
  deliverable: boolean | null
  label: string
  detail: Record<string, unknown>
  probe_from: string | null
}

function deliverableFromStatus(status: string): boolean | null {
  if (status === 'valid' || status === 'public') return true
  if (status === 'invalid') return false
  if (status === 'accept_all' || status === 'mx_check' || status === 'mx_likely') {
    return null
  }
  return null
}

function labelForResult(
  status: string,
  method: LiveVerifyResult['method_used'],
): string {
  if (status === 'valid') return 'Deliverable (mailbox accepted probe)'
  if (status === 'invalid') return 'Undeliverable (rejected or no MX)'
  if (status === 'accept_all') {
    return 'Accept-all domain — mailbox not confirmed'
  }
  if (status === 'mx_check') {
    return method === 'mx'
      ? 'Domain accepts mail (MX only — mailbox not tested)'
      : 'MX OK — SMTP inconclusive'
  }
  return 'Could not confirm deliverability'
}

async function verifyEmailSmtpWorker(
  email: string,
  mailFrom?: string | null,
): Promise<{ status: string; detail: Record<string, unknown> } | null> {
  const base = Deno.env.get('OSINT_WORKER_URL')?.replace(/\/$/, '')
  if (!base) return null
  const secret = Deno.env.get('OSINT_WORKER_SECRET')
  try {
    const res = await fetch(`${base}/v1/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        email,
        smtp: true,
        mail_from: mailFrom || undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        status: 'unknown',
        detail: {
          smtp_error: (body as { detail?: string })?.detail || `worker ${res.status}`,
        },
      }
    }
    return {
      status: typeof body.status === 'string' ? body.status : 'unknown',
      detail: (body.detail && typeof body.detail === 'object')
        ? body.detail as Record<string, unknown>
        : {},
    }
  } catch (e) {
    return {
      status: 'unknown',
      detail: {
        smtp_error: e instanceof Error ? e.message : 'worker unreachable',
      },
    }
  }
}

async function verifyEmailTomba(
  email: string,
  state: { quotaExhausted: boolean; quotaNote: string | null },
): Promise<{ status: string; detail: Record<string, unknown> } | null> {
  if (state.quotaExhausted || !tombaConfigured()) return null
  try {
    const status = await tombaEmailVerifier(email, state)
    if (!status) return null
    return {
      status:
        status === 'valid' || status === 'accept_all' || status === 'invalid'
          ? status
          : 'unknown',
      detail: { tomba: { status } },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/credit|quota|limit|monthly|429/i.test(msg)) {
      state.quotaExhausted = true
    }
    return null
  }
}

async function verifyEmailHunter(
  email: string,
  state: { quotaExhausted: boolean },
): Promise<{ status: string; detail: Record<string, unknown> } | null> {
  if (state.quotaExhausted || !Deno.env.get('HUNTER_API_KEY')) return null
  try {
    const verified = await hunterGet('email-verifier', { email })
    const status = verified?.data?.status || 'unknown'
    return {
      status: status === 'valid' || status === 'accept_all' || status === 'invalid'
        ? status
        : 'unknown',
      detail: { hunter: verified?.data || {} },
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (/credit|quota|limit|monthly|402|429/i.test(msg)) {
      state.quotaExhausted = true
    }
    return null
  }
}

export async function verifyEmailLive(
  emailInput: string,
  opts?: {
    /** Run SMTP RCPT when worker configured (Settings enable_smtp_verify). */
    preferSmtp?: boolean
    /** Use Hunter verifier when enabled and credits available. */
    hunterEnabled?: boolean
    /** Use Tomba verifier when enabled and credits available. */
    tombaEnabled?: boolean
    /** Gmail address for SMTP MAIL FROM (more realistic probe; no message sent). */
    mailFrom?: string | null
    /** Force method: mx | smtp | hunter | tomba | auto */
    method?: 'mx' | 'smtp' | 'hunter' | 'tomba' | 'auto'
  },
): Promise<LiveVerifyResult> {
  const email = sanitizeOutreachEmail(emailInput)
  if (!email) {
    return {
      verification_status: 'invalid',
      method_used: 'mx',
      deliverable: false,
      label: 'Invalid or blocked email address',
      detail: { reason: 'blocked_or_syntax' },
      probe_from: opts?.mailFrom || null,
    }
  }

  const method = opts?.method || 'auto'
  const hunterState = { quotaExhausted: false }
  const tombaState = { quotaExhausted: false, quotaNote: null as string | null }
  const probeFrom = opts?.mailFrom?.trim() || null

  if (method === 'tomba' || (method === 'auto' && opts?.tombaEnabled)) {
    const tomba = await verifyEmailTomba(email, tombaState)
    if (tomba && tomba.status !== 'unknown') {
      return {
        verification_status: tomba.status,
        method_used: 'tomba',
        deliverable: deliverableFromStatus(tomba.status),
        label: labelForResult(tomba.status, 'tomba'),
        detail: tomba.detail,
        probe_from: probeFrom,
      }
    }
    if (method === 'tomba') {
      const mx = await verifyEmailMx(email)
      return {
        verification_status: mx.status,
        method_used: 'mx',
        deliverable: deliverableFromStatus(mx.status),
        label: tombaState.quotaExhausted
          ? 'Tomba credits exhausted — MX check only'
          : 'Tomba unavailable — MX check only',
        detail: mx.detail,
        probe_from: probeFrom,
      }
    }
  }

  if (method === 'hunter' || (method === 'auto' && opts?.hunterEnabled)) {
    const hunter = await verifyEmailHunter(email, hunterState)
    if (hunter && hunter.status !== 'unknown') {
      return {
        verification_status: hunter.status,
        method_used: 'hunter',
        deliverable: deliverableFromStatus(hunter.status),
        label: labelForResult(hunter.status, 'hunter'),
        detail: hunter.detail,
        probe_from: probeFrom,
      }
    }
    if (method === 'hunter') {
      const mx = await verifyEmailMx(email)
      return {
        verification_status: mx.status,
        method_used: 'mx',
        deliverable: deliverableFromStatus(mx.status),
        label: hunterState.quotaExhausted
          ? 'Hunter credits exhausted — MX check only'
          : 'Hunter unavailable — MX check only',
        detail: mx.detail,
        probe_from: probeFrom,
      }
    }
  }

  const trySmtp =
    method === 'smtp' ||
    (method === 'auto' && opts?.preferSmtp && Boolean(Deno.env.get('OSINT_WORKER_URL')))

  if (trySmtp) {
    const smtp = await verifyEmailSmtpWorker(email, probeFrom)
    if (smtp) {
      if (smtp.status === 'valid' || smtp.status === 'invalid' || smtp.status === 'accept_all') {
        return {
          verification_status: smtp.status,
          method_used: 'smtp',
          deliverable: deliverableFromStatus(smtp.status),
          label: labelForResult(smtp.status, 'smtp'),
          detail: { ...smtp.detail, probe: 'smtp_rcpt', no_message_sent: true },
          probe_from: probeFrom,
        }
      }
      // Fall through to MX when SMTP inconclusive
      const mx = await verifyEmailMx(email)
      return {
        verification_status: mx.status === 'invalid' ? 'invalid' : 'mx_check',
        method_used: 'mx',
        deliverable: deliverableFromStatus(mx.status),
        label: labelForResult(
          mx.status === 'invalid' ? 'invalid' : 'mx_check',
          'mx',
        ),
        detail: { mx: mx.detail, smtp: smtp.detail },
        probe_from: probeFrom,
      }
    }
    if (method === 'smtp') {
      const mx = await verifyEmailMx(email)
      return {
        verification_status: mx.status,
        method_used: 'mx',
        deliverable: deliverableFromStatus(mx.status),
        label: 'SMTP worker not configured — MX check only',
        detail: mx.detail,
        probe_from: probeFrom,
      }
    }
  }

  const mx = await verifyEmailMx(email)
  return {
    verification_status: mx.status,
    method_used: 'mx',
    deliverable: deliverableFromStatus(mx.status),
    label: labelForResult(mx.status, 'mx'),
    detail: mx.detail,
    probe_from: probeFrom,
  }
}
