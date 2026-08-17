import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import {
  copyEmailToggles,
  ensureActiveSearchProfile,
  loadActiveSearchProfile,
} from '../_shared/searchProfile.ts'

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
  return s.slice(0, 80) || 'Search profile'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const admin = adminClient()
    const body = (await req.json().catch(() => ({}))) as {
      action?: string
      id?: string
      name?: string
      resume_id?: string
    }
    const action = body.action || 'list'

    if (action === 'list') {
      await ensureActiveSearchProfile(admin, user.id)
      const { data, error } = await admin
        .from('search_profiles')
        .select(
          'id, name, resume_id, is_active, profile, chat_summary, updated_at, resumes(file_name, uploaded_at)',
        )
        .eq('user_id', user.id)
        .order('is_active', { ascending: false })
        .order('updated_at', { ascending: false })
      if (error) return errorResponse(error.message, 500)
      return jsonResponse({ ok: true, profiles: data || [] })
    }

    if (action === 'rename') {
      const id = (body.id || '').trim()
      const name = cleanName(body.name)
      if (!id) return errorResponse('id required')
      const { error } = await admin
        .from('search_profiles')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id)
      if (error) return errorResponse(error.message, 500)
      await admin
        .from('contacts')
        .update({ search_profile_name: name })
        .eq('user_id', user.id)
        .eq('search_profile_id', id)
      await admin
        .from('search_runs')
        .update({ search_profile_name: name })
        .eq('user_id', user.id)
        .eq('search_profile_id', id)
      return jsonResponse({ ok: true, name })
    }

    if (action === 'activate') {
      const id = (body.id || '').trim()
      if (!id) return errorResponse('id required')
      const { data: row } = await admin
        .from('search_profiles')
        .select('id')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!row) return errorResponse('Search profile not found', 404)
      await admin
        .from('search_profiles')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .neq('id', id)
      await admin
        .from('search_profiles')
        .update({ is_active: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user.id)
      return jsonResponse({ ok: true, id })
    }

    if (action === 'create') {
      const resumeId = (body.resume_id || '').trim()
      if (!resumeId) return errorResponse('resume_id required')
      const { data: resume } = await admin
        .from('resumes')
        .select('id, file_name')
        .eq('id', resumeId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!resume) return errorResponse('Resume not found', 404)

      const { data: taken } = await admin
        .from('search_profiles')
        .select('id')
        .eq('resume_id', resumeId)
        .maybeSingle()
      if (taken) {
        return errorResponse('That resume already has a search profile')
      }

      const active = await loadActiveSearchProfile(admin, user.id)
      const { data: activeFilters } = active
        ? await admin
            .from('search_filters')
            .select('filters')
            .eq('search_profile_id', active.id)
            .maybeSingle()
        : { data: null }

      const name = cleanName(body.name || resume.file_name)
      const { data: created, error } = await admin
        .from('search_profiles')
        .insert({
          user_id: user.id,
          name,
          resume_id: resumeId,
          is_active: false,
          profile: {},
        })
        .select('id, name, resume_id, is_active')
        .single()
      if (error || !created) {
        return errorResponse(error?.message || 'Could not create profile', 500)
      }

      await admin.from('search_filters').insert({
        user_id: user.id,
        search_profile_id: created.id,
        filters: await copyEmailToggles(
          (activeFilters?.filters || null) as Record<string, unknown> | null,
        ),
      })
      await admin.from('preference_documents').insert({
        user_id: user.id,
        search_profile_id: created.id,
      })
      return jsonResponse({ ok: true, profile: created })
    }

    if (action === 'attach_resume') {
      const id = (body.id || '').trim()
      const resumeId = (body.resume_id || '').trim()
      if (!id || !resumeId) return errorResponse('id and resume_id required')
      const { data: resume } = await admin
        .from('resumes')
        .select('id, file_name')
        .eq('id', resumeId)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!resume) return errorResponse('Resume not found', 404)
      const { error } = await admin
        .from('search_profiles')
        .update({
          resume_id: resumeId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', user.id)
      if (error) return errorResponse(error.message, 500)
      return jsonResponse({ ok: true })
    }

    if (action === 'delete') {
      const id = (body.id || '').trim()
      if (!id) return errorResponse('id required')
      const { count } = await admin
        .from('search_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      if ((count || 0) <= 1) {
        return errorResponse('Keep at least one search profile')
      }
      const { data: row } = await admin
        .from('search_profiles')
        .select('id, resume_id, is_active')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle()
      if (!row) return errorResponse('Search profile not found', 404)

      if (row.resume_id) {
        const { data: resume } = await admin
          .from('resumes')
          .select('storage_path')
          .eq('id', row.resume_id)
          .maybeSingle()
        if (resume?.storage_path) {
          await admin.storage.from('resumes').remove([resume.storage_path])
        }
        await admin
          .from('search_profiles')
          .update({ resume_id: null })
          .eq('id', id)
        await admin.from('resumes').delete().eq('id', row.resume_id)
      }

      await admin.from('search_profiles').delete().eq('id', id).eq('user_id', user.id)

      if (row.is_active) {
        const { data: next } = await admin
          .from('search_profiles')
          .select('id')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (next) {
          await admin
            .from('search_profiles')
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq('id', next.id)
        }
      }
      return jsonResponse({ ok: true })
    }

    return errorResponse('Unknown action')
  } catch (e) {
    return errorResponse(
      e instanceof Error ? e.message : 'Search profile action failed',
      500,
    )
  }
})
