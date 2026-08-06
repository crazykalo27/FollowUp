import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'

/** Extract plain text from uploaded resume (txt/pdf-ish). Stores extracted_text. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const admin = adminClient()

    const { resume_id } = await req.json()
    if (!resume_id) return errorResponse('resume_id is required')

    const { data: resume, error } = await admin
      .from('resumes')
      .select('*')
      .eq('id', resume_id)
      .eq('user_id', user.id)
      .single()

    if (error || !resume) return errorResponse('Resume not found', 404)

    const { data: file, error: dlErr } = await admin.storage
      .from('resumes')
      .download(resume.storage_path)

    if (dlErr || !file) {
      return errorResponse(dlErr?.message || 'Download failed')
    }

    const buf = new Uint8Array(await file.arrayBuffer())
    let text = ''

    const name = resume.file_name.toLowerCase()
    if (name.endsWith('.txt') || file.type === 'text/plain') {
      text = new TextDecoder().decode(buf)
    } else {
      // Best-effort PDF/DOCX text scrape: pull printable ASCII/UTF-8 runs
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      const matches = raw.match(/[\x20-\x7E\n\r\t]{4,}/g) || []
      text = matches.join(' ').replace(/\s+/g, ' ').trim().slice(0, 50000)
    }

    await admin
      .from('resumes')
      .update({ extracted_text: text || null })
      .eq('id', resume_id)

    return jsonResponse({
      ok: true,
      chars: text.length,
      preview: text.slice(0, 400),
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
