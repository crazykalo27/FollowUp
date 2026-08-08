import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import { getGmailAccessToken, gmailApiGet } from '../_shared/gmail_client.ts'

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function encodeBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function encodeUtf8Base64Url(text: string): string {
  return encodeBase64Url(new TextEncoder().encode(text))
}

function mimeTypeForFilename(name: string, fallback?: string): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.doc')) return 'application/msword'
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
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
  const attachmentB64 = bytesToBase64(opts.attachmentBytes).replace(/(.{76})/g, '$1\r\n')

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const admin = adminClient()

    const { draft_id } = await req.json()
    if (!draft_id) return errorResponse('draft_id is required')

    const { data: draft, error: draftErr } = await admin
      .from('outreach_drafts')
      .select('*, contacts(email, full_name)')
      .eq('id', draft_id)
      .eq('user_id', user.id)
      .single()

    if (draftErr || !draft) return errorResponse('Draft not found', 404)
    if (draft.status === 'sent' || draft.status === 'pending') {
      return errorResponse(
        'This draft was already sent or is awaiting delivery confirmation.',
        400,
      )
    }

    const contactId = draft.contact_id as string
    const { data: priorSent } = await admin
      .from('outreach_drafts')
      .select('id, sent_at')
      .eq('user_id', user.id)
      .eq('contact_id', contactId)
      .in('status', ['sent', 'pending'])
      .maybeSingle()

    if (priorSent) {
      return errorResponse(
        'You already sent outreach to this person. Follow up or reply in your Gmail Sent mail — we do not send twice from FollowUp.',
        400,
      )
    }

    const contact = Array.isArray(draft.contacts)
      ? draft.contacts[0]
      : draft.contacts
    const to = contact?.email
    if (!to) return errorResponse('Contact has no email')

    const { data: tokenRow } = await admin
      .from('gmail_tokens')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!tokenRow) {
      return errorResponse('Gmail not connected', 400)
    }

    let accessToken: string
    let from = 'me'
    try {
      const tok = await getGmailAccessToken(admin, user.id)
      accessToken = tok.accessToken
      from = tok.email || 'me'
    } catch {
      return errorResponse('Gmail not connected', 400)
    }

    const { data: resume } = await admin
      .from('resumes')
      .select('*')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!resume) return errorResponse('Upload a resume before sending')

    const { data: fileData, error: dlErr } = await admin.storage
      .from('resumes')
      .download(resume.storage_path)

    if (dlErr || !fileData) {
      return errorResponse(dlErr?.message || 'Failed to download resume')
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer())
    const mime = buildMime({
      to,
      from,
      subject: draft.subject,
      body: draft.body,
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
      await admin
        .from('outreach_drafts')
        .update({
          status: 'failed',
          error_message: sendBody.error?.message || 'Gmail send failed',
        })
        .eq('id', draft_id)

      return errorResponse(
        sendBody.error?.message || 'Gmail send failed',
        502,
      )
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

    await admin
      .from('outreach_drafts')
      .update({
        status: 'pending',
        sent_at: new Date().toISOString(),
        error_message: null,
        gmail_message_id: gmailId,
        gmail_thread_id: threadId,
        bounce_detected_at: null,
        bounce_summary: null,
      })
      .eq('id', draft_id)

    return jsonResponse({
      ok: true,
      gmail_id: gmailId,
      gmail_thread_id: threadId,
      resume_attached: resume.file_name,
      sent_via: from,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
