import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import { parseJobPostingWithAi } from '../_shared/jobPosting.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth

    const body = await req.json().catch(() => ({}))
    const text =
      typeof body.text === 'string'
        ? body.text
        : typeof body.job_posting_text === 'string'
          ? body.job_posting_text
          : ''

    if (!text.trim()) {
      return errorResponse(
        'Paste the company name and job description from the application.',
        400,
      )
    }

    const parsed = await parseJobPostingWithAi(text)
    return jsonResponse({ ok: true, parsed })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
