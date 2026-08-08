import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import {
  runPreferenceGradientRefine,
  type RefineDecision,
} from '../_shared/preferenceGradient.ts'

/**
 * After orientation calibration reviews, run preference gradient descent:
 * update industries / roles / filters and return plain-language steps.
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
    const body = await req.json().catch(() => ({}))

    let decisions: RefineDecision[] = Array.isArray(body.decisions)
      ? (body.decisions as RefineDecision[])
      : []

    if (decisions.length === 0) {
      // Load recent decisions from DB (calibration batch)
      const { data: rows } = await admin
        .from('contact_decisions')
        .select(
          'decision, reasons, note, created_at, contacts(full_name, title, filter_match_reason, source_details, companies(name, hiring_signal_title))',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(12)

      decisions = (rows || []).map((row) => {
        const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
        const company = contact?.companies
          ? Array.isArray(contact.companies)
            ? contact.companies[0]
            : contact.companies
          : null
        const details = (contact?.source_details || {}) as Record<string, unknown>
        return {
          decision: row.decision as 'keep' | 'discard',
          reasons: (row.reasons as string[]) || [],
          note: row.note as string | null,
          contact_title: contact?.title || null,
          company_name: company?.name || null,
          hiring_signal:
            (typeof details.hiring_signal === 'string' && details.hiring_signal) ||
            company?.hiring_signal_title ||
            null,
          match_reason: contact?.filter_match_reason || null,
        }
      })
    }

    if (decisions.length === 0) {
      return errorResponse(
        'Review at least a few contacts before refining your targets.',
        400,
      )
    }

    const result = await runPreferenceGradientRefine(admin, user.id, decisions)

    await admin
      .from('profiles')
      .update({
        orientation_step: 'refine',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    return jsonResponse({
      ok: true,
      industries: result.industries,
      roles: result.roles,
      include_titles: result.include_titles,
      steps: result.steps,
      explored: result.explored,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
