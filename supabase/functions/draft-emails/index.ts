import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import {
  applyTemplate,
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  formatEmploymentTypes,
  formatRemotePref,
  stripRemainingPlaceholders,
  type TemplateVars,
} from '../_shared/emailTemplate.ts'
import { formatApplicationJobDescription } from '../_shared/jobPosting.ts'

function buildVars(
  contact: {
    full_name?: string | null
    first_name?: string | null
    title?: string | null
    filter_match_reason?: string | null
    application_context?: {
      job_title?: string | null
      job_description?: string | null
      company?: string | null
      projects?: string[] | null
      responsibilities?: string[] | null
    } | null
    source_details?: {
      job_description?: string | null
      application?: {
        job_title?: string | null
        job_description?: string | null
        company?: string | null
        projects?: string[] | null
        responsibilities?: string[] | null
      } | null
    } | null
  },
  company: {
    name?: string
    hiring_signal_title?: string | null
  } | null,
  sender: {
    full_name: string
    linkedin_url?: string | null
    github_url?: string | null
    portfolio_url?: string | null
    website_url?: string | null
  },
  profile: {
    roles?: string[]
    industries?: string[]
    employment_types?: string[]
    remote_preference?: string
  },
): TemplateVars {
  const recipient =
    contact.full_name?.trim() ||
    contact.first_name?.trim() ||
    'there'
  const app =
    contact.application_context ||
    contact.source_details?.application ||
    null
  const storedJobDescription =
    (typeof contact.source_details?.job_description === 'string'
      ? contact.source_details.job_description
      : null)?.trim() ||
    app?.job_description?.trim() ||
    ''
  const jobDescription =
    (app
      ? formatApplicationJobDescription({
          job_title: app.job_title,
          job_description: storedJobDescription || app.job_description,
          company: app.company || company?.name,
          projects: app.projects,
          responsibilities: app.responsibilities,
          contact_title: contact.title,
        })
      : '') ||
    storedJobDescription ||
    app?.job_title?.trim() ||
    company?.hiring_signal_title?.trim() ||
    ''

  return {
    recipient,
    first_name: contact.first_name?.trim() || recipient.split(/\s+/)[0] || '',
    name: sender.full_name,
    date: new Date().toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    job: contact.title?.trim() || 'your team',
    target_role: profile.roles?.[0]?.trim() || 'opportunities',
    company: company?.name?.trim() || app?.company?.trim() || 'your company',
    industry: profile.industries?.[0]?.trim() || 'your field',
    hiring_signal:
      company?.hiring_signal_title?.trim() ||
      app?.job_title?.trim() ||
      'your open roles',
    job_description: jobDescription,
    'job description': jobDescription,
    employment_type: formatEmploymentTypes(profile.employment_types),
    remote: formatRemotePref(profile.remote_preference),
    linkedin: sender.linkedin_url?.trim() || '',
    github: sender.github_url?.trim() || '',
    portfolio: sender.portfolio_url?.trim() || '',
    website: sender.website_url?.trim() || '',
  }
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
      if (existingDraft.status === 'sent' || existingDraft.status === 'pending') {
        return errorResponse(
          'Cannot regenerate a draft that was already sent or is pending delivery',
          400,
        )
      }
      replaceDraftId = draftId
      contactIdsFilter = [existingDraft.contact_id]
    }

    let contactsQuery = admin
      .from('contacts')
      .select(
        'id, full_name, first_name, title, email, filter_match_reason, company_id, application_context, source_details, companies(name, domain, hiring_signal_title, hiring_signal_url)',
      )
      .eq('user_id', user.id)
      .not('email', 'is', null)

    if (contactIdsFilter?.length) {
      contactsQuery = contactsQuery.in('id', contactIdsFilter)
    }

    const { data: contacts, error } = await contactsQuery.limit(25)
    if (error) return errorResponse(error.message, 500)
    if (!contacts?.length) return errorResponse('No contacts with emails found')

    const { data: sentRows } = await admin
      .from('outreach_drafts')
      .select('contact_id')
      .eq('user_id', user.id)
      .in('status', ['sent', 'pending'])

    const sentContactIds = new Set(
      (sentRows || []).map((r) => r.contact_id as string),
    )
    const skippedAlreadySent: Array<{ contact_id: string; name: string | null }> =
      []

    const { data: profileRow } = await admin
      .from('search_profiles')
      .select('profile')
      .eq('user_id', user.id)
      .maybeSingle()

    const { data: senderRow } = await admin
      .from('profiles')
      .select(
        'full_name, linkedin_url, github_url, portfolio_url, website_url, profile_setup_complete, email_subject_template, email_body_template',
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

    const sender = {
      full_name: senderFullName,
      linkedin_url: senderRow?.linkedin_url,
      github_url: senderRow?.github_url,
      portfolio_url: senderRow?.portfolio_url,
      website_url: senderRow?.website_url,
    }

    const profile = (profileRow?.profile || {}) as {
      roles?: string[]
      industries?: string[]
      employment_types?: string[]
      remote_preference?: string
    }

    const subjectTemplate =
      senderRow?.email_subject_template?.trim() ||
      DEFAULT_EMAIL_SUBJECT_TEMPLATE
    const bodyTemplate =
      senderRow?.email_body_template?.trim() || DEFAULT_EMAIL_BODY_TEMPLATE
    const drafts = []

    for (const contact of contacts) {
      if (!replaceDraftId && sentContactIds.has(contact.id)) {
        skippedAlreadySent.push({
          contact_id: contact.id,
          name: contact.full_name || contact.first_name || null,
        })
        continue
      }

      const company = Array.isArray(contact.companies)
        ? contact.companies[0]
        : contact.companies

      const vars = buildVars(contact, company, sender, profile)
      const subject = stripRemainingPlaceholders(
        applyTemplate(subjectTemplate, vars),
      )
      const emailBody = stripRemainingPlaceholders(
        applyTemplate(bodyTemplate, vars),
      )

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

    return jsonResponse({ drafts, skipped_already_sent: skippedAlreadySent })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
