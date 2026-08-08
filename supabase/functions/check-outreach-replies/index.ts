import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import {
  fetchThreadMessages,
  getGmailAccessToken,
  headerValue,
  looksLikeDeliveryFailure,
  messagePlainText,
} from '../_shared/gmail_client.ts'

const PENDING_CONFIRM_MS = 5 * 60 * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const admin = adminClient()

    const body = await req.json().catch(() => ({}))
    const draftId =
      typeof body.draft_id === 'string' ? body.draft_id : null

    let query = admin
      .from('outreach_drafts')
      .select('id, gmail_thread_id, gmail_message_id, status, sent_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .not('sent_at', 'is', null)

    if (draftId) query = query.eq('id', draftId)

    const { data: drafts, error: listErr } = await query.limit(40)
    if (listErr) return errorResponse(listErr.message, 500)
    if (!drafts?.length) {
      return jsonResponse({
        ok: true,
        checked: 0,
        bounced: 0,
        confirmed: 0,
        still_pending: 0,
      })
    }

    let accessToken: string | null = null
    let userEmail: string | null = null
    try {
      const tok = await getGmailAccessToken(admin, user.id)
      accessToken = tok.accessToken
      userEmail = tok.email
    } catch {
      accessToken = null
    }

    const userEmailLower = (userEmail || '').toLowerCase()
    let bouncedCount = 0
    let confirmedCount = 0
    let stillPending = 0
    const now = Date.now()

    for (const draft of drafts) {
      const sentMs = draft.sent_at
        ? new Date(draft.sent_at as string).getTime()
        : 0
      const ageMs = sentMs ? now - sentMs : 0
      const threadId = draft.gmail_thread_id as string | null

      let bounced = false

      if (accessToken && threadId) {
        let messages
        try {
          messages = await fetchThreadMessages(accessToken, threadId)
        } catch {
          messages = null
        }

        if (messages) {
          for (const msg of messages) {
            if (msg.id === draft.gmail_message_id) continue
            const from = headerValue(msg, 'From')
            const subject = headerValue(msg, 'Subject')
            const fromLower = from.toLowerCase()
            if (userEmailLower && fromLower.includes(userEmailLower)) continue

            const msgMs = msg.internalDate
              ? Number(msg.internalDate)
              : 0
            if (sentMs && msgMs && msgMs < sentMs - 60_000) continue

            const text = messagePlainText(msg)
            const check = looksLikeDeliveryFailure(from, subject, text)
            if (!check.bounced) continue

            const { error: updErr } = await admin
              .from('outreach_drafts')
              .update({
                status: 'bounced',
                bounce_detected_at: new Date().toISOString(),
                bounce_summary: check.summary,
                error_message:
                  'Delivery failed — this address may be wrong or the mailbox was not found.',
              })
              .eq('id', draft.id)
              .eq('user_id', user.id)
              .eq('status', 'pending')

            if (!updErr) bouncedCount += 1
            bounced = true
            break
          }
        }
      }

      if (bounced) continue

      if (ageMs >= PENDING_CONFIRM_MS) {
        const { error: updErr } = await admin
          .from('outreach_drafts')
          .update({
            status: 'sent',
            error_message: null,
          })
          .eq('id', draft.id)
          .eq('user_id', user.id)
          .eq('status', 'pending')

        if (!updErr) confirmedCount += 1
      } else {
        stillPending += 1
      }
    }

    return jsonResponse({
      ok: true,
      checked: drafts.length,
      bounced: bouncedCount,
      confirmed: confirmedCount,
      still_pending: stillPending,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
