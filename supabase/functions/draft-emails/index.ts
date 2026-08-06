import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  openaiChat,
  requireUser,
} from '../_shared/cors.ts'

function stripBracketPlaceholders(text: string): string {
  return text
    .replace(/\[[^\]]{2,60}\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

    const body = await req.json().catch(() => ({}))
    const contactIds: string[] | undefined = body.contact_ids
    const draftId =
      typeof body.draft_id === 'string' ? body.draft_id.trim() : undefined

    let replaceDraftId: string | undefined
    let contactIdsFilter: string[] | undefined = contactIds

    if (draftId) {
      const { data: existingDraft, error: draftLoadErr } = await admin
        .from('outreach_drafts')
        .select('id, contact_id, status')
        .eq('id', draftId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (draftLoadErr) return errorResponse(draftLoadErr.message, 500)
      if (!existingDraft) return errorResponse('Draft not found', 404)
      if (existingDraft.status === 'sent') {
        return errorResponse('Cannot regenerate a draft that was already sent', 400)
      }
      replaceDraftId = draftId
      contactIdsFilter = [existingDraft.contact_id]
    }

    let contactsQuery = admin
      .from('contacts')
      .select(
        'id, full_name, first_name, title, email, filter_match_reason, company_id, companies(name, domain, hiring_signal_title, hiring_signal_url)',
      )
      .eq('user_id', user.id)
      .not('email', 'is', null)

    if (contactIdsFilter?.length) {
      contactsQuery = contactsQuery.in('id', contactIdsFilter)
    }

    const { data: contacts, error } = await contactsQuery.limit(25)
    if (error) return errorResponse(error.message, 500)
    if (!contacts?.length) return errorResponse('No contacts with emails found')

    const { data: resume } = await admin
      .from('resumes')
      .select('extracted_text, file_name')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: profileRow } = await admin
      .from('search_profiles')
      .select('profile')
      .eq('user_id', user.id)
      .maybeSingle()

    const { data: senderRow } = await admin
      .from('profiles')
      .select(
        'full_name, linkedin_url, github_url, portfolio_url, website_url, profile_setup_complete',
      )
      .eq('id', user.id)
      .maybeSingle()

    const senderFullName = (senderRow?.full_name || '').trim()
    if (!senderFullName) {
      return errorResponse(
        'Add your full name in Settings (or complete welcome setup) before drafting emails.',
        400,
      )
    }

    const senderForPrompt: Record<string, string> = { full_name: senderFullName }
    if (senderRow?.linkedin_url?.trim()) {
      senderForPrompt.linkedin_url = senderRow.linkedin_url.trim()
    }
    if (senderRow?.github_url?.trim()) {
      senderForPrompt.github_url = senderRow.github_url.trim()
    }
    if (senderRow?.portfolio_url?.trim()) {
      senderForPrompt.portfolio_url = senderRow.portfolio_url.trim()
    }
    if (senderRow?.website_url?.trim()) {
      senderForPrompt.website_url = senderRow.website_url.trim()
    }

    const profile = profileRow?.profile || {}
    const resumeSnippet = (resume?.extracted_text || '').slice(0, 4000)
    const drafts = []

    for (const contact of contacts) {
      const company = Array.isArray(contact.companies)
        ? contact.companies[0]
        : contact.companies

      const prompt = `Write a short cold outreach email from a job seeker to a hiring manager.
Return JSON only: {"subject":"...","body":"..."}

SENDER (only these fields exist — use in signature; omit anything not listed):
${JSON.stringify(senderForPrompt)}

Rules:
- Body plain text, under 180 words.
- Mention hiring signal when present.
- Ask for a brief conversation; do not beg.
- Tone: ${(profile as { tone?: string }).tone || 'professional and concise'}
- Reference resume skills only when natural and supported by resume text.
- Do not invent employer history not in the resume.
- NEVER use bracket placeholders ([Your Name], [LinkedIn], [Portfolio], etc.).
- NEVER write "insert your …" or placeholder links.
- Signature: sign with sender full_name. Include ONLY URLs that appear in SENDER JSON (e.g. if github_url is missing, do not mention GitHub).

Recipient: ${contact.full_name || contact.first_name || 'there'} (${contact.title || 'manager'})
Company: ${(company as { name?: string })?.name || 'the company'}
Hiring signal: ${(company as { hiring_signal_title?: string })?.hiring_signal_title || 'open roles'}
Why selected: ${contact.filter_match_reason || ''}
Candidate search profile JSON: ${JSON.stringify(profile)}
Resume excerpt:
${resumeSnippet}`

      const raw = await openaiChat(
        [
          {
            role: 'system',
            content:
              'You draft concise hiring-manager outreach emails. Output JSON only. Never use placeholder brackets or fake links.',
          },
          { role: 'user', content: prompt },
        ],
        {
          temperature: replaceDraftId ? 0.75 : 0.6,
          response_format: { type: 'json_object' },
        },
      )

      let subject = `Exploring opportunities at ${(company as { name?: string })?.name || 'your team'}`
      let emailBody = raw
      try {
        const parsed = JSON.parse(raw)
        subject = parsed.subject || subject
        emailBody = parsed.body || raw
      } catch {
        // keep defaults
      }

      emailBody = stripBracketPlaceholders(emailBody)

      if (replaceDraftId) {
        const { data: draft, error: draftErr } = await admin
          .from('outreach_drafts')
          .update({
            subject,
            body: emailBody,
            status: 'draft',
            error_message: null,
            sent_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', replaceDraftId)
          .eq('user_id', user.id)
          .select('*')
          .single()
        if (!draftErr && draft) drafts.push(draft)
        continue
      }

      const { data: draft, error: draftErr } = await admin
        .from('outreach_drafts')
        .insert({
          user_id: user.id,
          contact_id: contact.id,
          subject,
          body: emailBody,
          status: 'draft',
        })
        .select('*')
        .single()

      if (!draftErr && draft) drafts.push(draft)
    }

    return jsonResponse({ drafts })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
