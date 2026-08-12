import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import { recordInitialGuessAttempt } from '../_shared/bounce_retry.ts'
import { sendOutreachMime } from '../_shared/outreach_send.ts'

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

    let sendResult
    try {
      sendResult = await sendOutreachMime({
        admin,
        userId: user.id,
        to,
        subject: draft.subject,
        body: draft.body,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gmail send failed'
      if (msg !== 'Gmail not connected' && msg !== 'Upload a resume before sending') {
        await admin
          .from('outreach_drafts')
          .update({
            status: 'failed',
            error_message: msg,
          })
          .eq('id', draft_id)
      }
      return errorResponse(
        msg,
        msg === 'Gmail not connected' || msg === 'Upload a resume before sending'
          ? 400
          : 502,
      )
    }

    await admin
      .from('outreach_drafts')
      .update({
        status: 'pending',
        sent_at: new Date().toISOString(),
        error_message: null,
        gmail_message_id: sendResult.gmail_id,
        gmail_thread_id: sendResult.gmail_thread_id,
        bounce_detected_at: null,
        bounce_summary: null,
      })
      .eq('id', draft_id)

    await recordInitialGuessAttempt({
      admin,
      userId: user.id,
      contactId,
      email: to,
    })

    return jsonResponse({
      ok: true,
      gmail_id: sendResult.gmail_id,
      gmail_thread_id: sendResult.gmail_thread_id,
      resume_attached: sendResult.resume_attached,
      sent_via: sendResult.sent_via,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
