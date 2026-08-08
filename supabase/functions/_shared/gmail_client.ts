import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string
  expires_in?: number
}> {
  const clientId = Deno.env.get('GOOGLE_GMAIL_CLIENT_ID')!
  const clientSecret = Deno.env.get('GOOGLE_GMAIL_CLIENT_SECRET')!
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error || 'Failed to refresh Gmail token')
  return body as { access_token: string; expires_in?: number }
}

export async function getGmailAccessToken(
  admin: SupabaseClient,
  userId: string,
): Promise<{ accessToken: string; email: string | null }> {
  const { data: tokenRow } = await admin
    .from('gmail_tokens')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (!tokenRow?.refresh_token) {
    throw new Error('Gmail not connected')
  }

  let accessToken = tokenRow.access_token as string | null
  const expired =
    !tokenRow.expires_at ||
    new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000

  if (!accessToken || expired) {
    const refreshed = await refreshAccessToken(tokenRow.refresh_token)
    accessToken = refreshed.access_token
    await admin
      .from('gmail_tokens')
      .update({
        access_token: accessToken,
        expires_at: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
          : null,
      })
      .eq('user_id', userId)
  }

  return { accessToken, email: tokenRow.email as string | null }
}

export async function gmailApiGet<T>(
  accessToken: string,
  path: string,
): Promise<T> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  const body = await res.json()
  if (!res.ok) {
    throw new Error(body?.error?.message || `Gmail API ${res.status}`)
  }
  return body as T
}

type GmailHeader = { name?: string; value?: string }
type GmailPart = {
  mimeType?: string
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}
type GmailMessage = {
  id?: string
  threadId?: string
  snippet?: string
  payload?: { headers?: GmailHeader[]; parts?: GmailPart[]; body?: { data?: string } }
  internalDate?: string
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  try {
    return new TextDecoder().decode(
      Uint8Array.from(atob(padded + pad), (c) => c.charCodeAt(0)),
    )
  } catch {
    return ''
  }
}

function collectTextFromParts(part: GmailPart | undefined, out: string[]) {
  if (!part) return
  if (part.body?.data) {
    out.push(decodeBase64Url(part.body.data))
  }
  for (const child of part.parts || []) {
    collectTextFromParts(child, out)
  }
}

export function messagePlainText(msg: GmailMessage): string {
  const chunks: string[] = []
  if (msg.payload?.body?.data) {
    chunks.push(decodeBase64Url(msg.payload.body.data))
  }
  for (const p of msg.payload?.parts || []) {
    collectTextFromParts(p, chunks)
  }
  if (msg.snippet) chunks.push(msg.snippet)
  return chunks.join('\n').slice(0, 12_000)
}

export function headerValue(
  msg: GmailMessage,
  name: string,
): string {
  const h = msg.payload?.headers?.find(
    (x) => (x.name || '').toLowerCase() === name.toLowerCase(),
  )
  return h?.value || ''
}

const BOUNCE_PATTERNS = [
  /mailer[- ]?daemon/i,
  /mail delivery subsystem/i,
  /postmaster@/i,
  /delivery status notification/i,
  /undeliverable/i,
  /undelivered/i,
  /mailbox not found/i,
  /address rejected/i,
  /recipient address rejected/i,
  /user unknown/i,
  /550[\s-]?5\.1\.1/i,
  /550 5\.1\.1/i,
  /does not exist/i,
  /invalid recipient/i,
  /could not be delivered/i,
  /no longer at this address/i,
  /address couldn't be found/i,
  /the email account that you tried to reach/i,
  /wasn't delivered/i,
]

export function looksLikeDeliveryFailure(
  from: string,
  subject: string,
  body: string,
): { bounced: boolean; summary: string | null } {
  const blob = `${from}\n${subject}\n${body}`.slice(0, 10_000)
  for (const re of BOUNCE_PATTERNS) {
    const m = blob.match(re)
    if (m) {
      return {
        bounced: true,
        summary: m[0].slice(0, 120),
      }
    }
  }
  if (/^mailer-daemon@/i.test(from.trim())) {
    return { bounced: true, summary: 'Mailer-daemon reply' }
  }
  return { bounced: false, summary: null }
}

export async function fetchThreadMessages(
  accessToken: string,
  threadId: string,
): Promise<GmailMessage[]> {
  const thread = await gmailApiGet<{ messages?: GmailMessage[] }>(
    accessToken,
    `/threads/${threadId}?format=full`,
  )
  return thread.messages || []
}
