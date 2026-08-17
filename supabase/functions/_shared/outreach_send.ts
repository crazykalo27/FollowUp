/**
 * Shared Gmail send for outreach drafts (initial send + bounce retries).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { getGmailAccessToken, gmailApiGet } from './gmail_client.ts'

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function encodeBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function encodeUtf8Base64Url(text: string): string {
  return encodeBase64Url(new TextEncoder().encode(text))
}

function mimeTypeForFilename(name: string, fallback?: string): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.doc')) return 'application/msword'
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  if (lower.endsWith('.txt')) return 'text/plain'
  return fallback || 'application/pdf'
}

function buildMime(opts: {
  to: string
  from: string
  subject: string
  body: string
  filename: string
  attachmentBytes: Uint8Array
  contentType: string
}): string {
  const boundary = `followup_${crypto.randomUUID().replace(/-/g, '')}`
  const attachmentB64 = bytesToBase64(opts.attachmentBytes).replace(
    /(.{76})/g,
    '$1\r\n',
  )

  return [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(opts.subject)))}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    opts.body,
    '',
    `--${boundary}`,
    `Content-Type: ${opts.contentType}; name="${opts.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${opts.filename}"`,
    '',
    attachmentB64,
    `--${boundary}--`,
  ].join('\r\n')
}

export type OutreachSendResult = {
  gmail_id: string
  gmail_thread_id: string | null
  resume_attached: string
  sent_via: string
  to: string
}

/** Send the draft body+subject to `to` via the user's Gmail with resume attached. */
export async function sendOutreachMime(opts: {
  admin: SupabaseClient
  userId: string
  to: string
  subject: string
  body: string
  resumeId?: string | null
}): Promise<OutreachSendResult> {
  const { admin, userId, to, subject, body, resumeId } = opts

  let accessToken: string
  let from = 'me'
  try {
    const tok = await getGmailAccessToken(admin, userId)
    accessToken = tok.accessToken
    from = tok.email || 'me'
  } catch {
    throw new Error('Gmail not connected')
  }

  let resumeQuery = admin
    .from('resumes')
    .select('*')
    .eq('user_id', userId)
  const { data: resume } = resumeId
    ? await resumeQuery.eq('id', resumeId).maybeSingle()
    : await resumeQuery.order('uploaded_at', { ascending: false }).limit(1).maybeSingle()

  if (!resume) throw new Error('Upload a resume before sending')

  const { data: fileData, error: dlErr } = await admin.storage
    .from('resumes')
    .download(resume.storage_path)

  if (dlErr || !fileData) {
    throw new Error(dlErr?.message || 'Failed to download resume')
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer())
  const mime = buildMime({
    to,
    from,
    subject,
    body,
    filename: resume.file_name,
    attachmentBytes: bytes,
    contentType: mimeTypeForFilename(resume.file_name, fileData.type),
  })

  const raw = encodeUtf8Base64Url(mime)
  const sendRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    },
  )

  const sendBody = await sendRes.json()
  if (!sendRes.ok) {
    throw new Error(sendBody.error?.message || 'Gmail send failed')
  }

  const gmailId = sendBody.id as string
  let threadId: string | null = sendBody.threadId || null
  try {
    const meta = await gmailApiGet<{ threadId?: string }>(
      accessToken,
      `/messages/${gmailId}?format=metadata&metadataHeaders=Subject`,
    )
    threadId = meta.threadId || threadId
  } catch {
    // thread id optional for send success
  }

  return {
    gmail_id: gmailId,
    gmail_thread_id: threadId,
    resume_attached: resume.file_name,
    sent_via: from,
    to,
  }
}
