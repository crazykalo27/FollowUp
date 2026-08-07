import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'

/**
 * Wipe all FollowUp data for the signed-in user and reset orientation.
 * Auth account remains so they can sign in again and start fresh.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const admin = adminClient()
    const uid = user.id

    // Order: dependents first
    await admin.from('outreach_drafts').delete().eq('user_id', uid)
    await admin.from('contact_decisions').delete().eq('user_id', uid)
    await admin.from('contacts').delete().eq('user_id', uid)
    await admin.from('companies').delete().eq('user_id', uid)
    await admin.from('search_runs').delete().eq('user_id', uid)
    await admin.from('profile_chat_messages').delete().eq('user_id', uid)
    await admin.from('search_profiles').delete().eq('user_id', uid)
    await admin.from('preference_documents').delete().eq('user_id', uid)
    await admin.from('gmail_tokens').delete().eq('user_id', uid)

    // Resumes + storage objects
    const { data: resumes } = await admin
      .from('resumes')
      .select('storage_path')
      .eq('user_id', uid)
    if (resumes?.length) {
      const paths = resumes
        .map((r) => r.storage_path)
        .filter((p): p is string => Boolean(p))
      if (paths.length) {
        await admin.storage.from('resumes').remove(paths)
      }
    }
    await admin.from('resumes').delete().eq('user_id', uid)

    // Reset filters to defaults (hunter / verified off)
    await admin.from('search_filters').delete().eq('user_id', uid)
    await admin.from('search_filters').insert({
      user_id: uid,
      filters: {
        include_titles: [
          'Engineering Manager',
          'Hiring Manager',
          'Director',
          'Head of',
          'VP',
          'Team Lead',
        ],
        exclude_titles: [
          'Recruiter',
          'Talent Acquisition',
          'People Ops',
          'HR',
          'Sourcer',
          'Staffing',
        ],
        locations: [],
        company_size_min: null,
        company_size_max: null,
        seniority: ['senior', 'executive'],
        max_companies_per_run: 10,
        max_contacts_per_company: 3,
        require_verified_email: false,
        accept_accept_all: true,
        enable_hunter: false,
      },
    })

    await admin.from('preference_documents').upsert(
      {
        user_id: uid,
        likes_doc: '',
        dislikes_doc: '',
        ai_summary: null,
        discard_reason_counts: {},
      },
      { onConflict: 'user_id' },
    )

    // Reset profile / orientation (keep auth id)
    await admin
      .from('profiles')
      .update({
        full_name: null,
        display_name: null,
        linkedin_url: null,
        github_url: null,
        portfolio_url: null,
        website_url: null,
        email_subject_template: null,
        email_body_template: null,
        profile_setup_complete: false,
        onboarding_complete: false,
        orientation_step: 'welcome',
        orientation_complete: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', uid)

    return jsonResponse({ ok: true })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
