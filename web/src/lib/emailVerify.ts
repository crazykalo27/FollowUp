/** Client helpers for live email verification (no message sent). */

export type LiveVerifyResponse = {
  ok: boolean
  email: string
  verification_status: string
  method_used: 'mx' | 'smtp' | 'hunter'
  deliverable: boolean | null
  label: string
  detail: Record<string, unknown>
  probe_from: string | null
  gmail_connected: boolean
  no_message_sent: boolean
}

export function liveVerifyTone(
  deliverable: boolean | null,
  status: string,
): 'good' | 'warn' | 'bad' | 'muted' {
  if (deliverable === true || status === 'valid') return 'good'
  if (deliverable === false || status === 'invalid') return 'bad'
  if (status === 'accept_all' || status === 'mx_check' || status === 'mx_likely') {
    return 'warn'
  }
  return 'muted'
}
