import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import { recommendFiltersForUser } from '../_shared/recommendFilters.ts'

/** AI writes search_filters from resume + profile + preference docs. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const admin = adminClient()

    const filters = await recommendFiltersForUser(admin, user.id)
    if (!filters) {
      return errorResponse('Could not build filter recommendation', 500)
    }

    return jsonResponse({
      ok: true,
      filters: {
        include_titles: filters.include_titles,
        exclude_titles: filters.exclude_titles,
        locations: filters.locations,
        seniority: filters.seniority,
        company_size_min: filters.company_size_min,
        company_size_max: filters.company_size_max,
        require_verified_email: filters.require_verified_email,
        accept_accept_all: filters.accept_accept_all,
      },
      rationale: filters.rationale || null,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
