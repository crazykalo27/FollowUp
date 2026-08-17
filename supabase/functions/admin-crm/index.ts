import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import { adminEmailsFromEnv, isAdminUser } from '../_shared/adminAccess.ts'

type View = 'whoami' | 'overview' | 'user'

type AuthUserRow = {
  id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
}

async function fetchAllRows<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const page = 1000
  const out: T[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await run(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = data || []
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}

function bump(map: Map<string, number>, key: string, n = 1) {
  map.set(key, (map.get(key) || 0) + n)
}

async function listAuthUsers(
  admin: ReturnType<typeof adminClient>,
): Promise<AuthUserRow[]> {
  const out: AuthUserRow[] = []
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    })
    if (error) throw new Error(error.message)
    const users = data?.users || []
    for (const u of users) {
      out.push({
        id: u.id,
        email: u.email ?? null,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
      })
    }
    if (users.length < 200) break
  }
  return out
}

function featureFlags(filters: Record<string, unknown> | null | undefined) {
  const f = filters || {}
  return {
    hunter: f.enable_hunter === true,
    apollo: f.enable_apollo === true,
    tomba: f.enable_tomba === true,
    smtp: f.enable_smtp_verify === true,
  }
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

    if (!isAdminUser(user)) {
      const configured = adminEmailsFromEnv().length > 0
      return errorResponse(
        configured
          ? 'Not an admin'
          : 'Admin access is not configured — set ADMIN_EMAILS (comma-separated login emails) as an Edge Function secret',
        403,
      )
    }

    const body = (await req.json().catch(() => ({}))) as {
      view?: View
      user_id?: string
    }
    const view: View = body.view || 'overview'
    const admin = adminClient()

    if (view === 'whoami') {
      return jsonResponse({ ok: true, admin: true })
    }

    if (view === 'user') {
      const userId = (body.user_id || '').trim()
      if (!userId) return errorResponse('user_id required')
      return jsonResponse(await loadUserDetail(admin, userId))
    }

    return jsonResponse(await loadOverview(admin))
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Admin CRM failed', 500)
  }
})

async function loadOverview(admin: ReturnType<typeof adminClient>) {
  const [
    authUsers,
    profiles,
    resumes,
    runs,
    contacts,
    drafts,
    gmail,
    filters,
    chats,
  ] = await Promise.all([
    listAuthUsers(admin),
    fetchAllRows<{
      id: string
      display_name: string | null
      full_name: string | null
      orientation_complete: boolean
      orientation_step: string
      created_at: string
      updated_at: string
    }>((from, to) =>
      admin
        .from('profiles')
        .select(
          'id, display_name, full_name, orientation_complete, orientation_step, created_at, updated_at',
        )
        .range(from, to),
    ),
    fetchAllRows<{ user_id: string }>((from, to) =>
      admin.from('resumes').select('user_id').range(from, to),
    ),
    fetchAllRows<{ user_id: string }>((from, to) =>
      admin.from('search_runs').select('user_id').range(from, to),
    ),
    fetchAllRows<{ user_id: string; review_status: string }>((from, to) =>
      admin.from('contacts').select('user_id, review_status').range(from, to),
    ),
    fetchAllRows<{ user_id: string; status: string }>((from, to) =>
      admin.from('outreach_drafts').select('user_id, status').range(from, to),
    ),
    fetchAllRows<{ user_id: string }>((from, to) =>
      admin.from('gmail_tokens').select('user_id').range(from, to),
    ),
    fetchAllRows<{ user_id: string; filters: Record<string, unknown> | null }>(
      (from, to) =>
        admin.from('search_filters').select('user_id, filters').range(from, to),
    ),
    fetchAllRows<{ user_id: string }>((from, to) =>
      admin.from('profile_chat_messages').select('user_id').range(from, to),
    ),
  ])

  const resumeBy = new Map<string, number>()
  const searchBy = new Map<string, number>()
  const contactBy = new Map<string, number>()
  const keptBy = new Map<string, number>()
  const discardBy = new Map<string, number>()
  const draftBy = new Map<string, number>()
  const sentBy = new Map<string, number>()
  const bouncedBy = new Map<string, number>()
  const chatBy = new Map<string, number>()
  const gmailSet = new Set<string>()
  const filterBy = new Map<string, ReturnType<typeof featureFlags>>()

  for (const r of resumes) bump(resumeBy, r.user_id)
  for (const r of runs) bump(searchBy, r.user_id)
  for (const r of contacts) {
    bump(contactBy, r.user_id)
    if (r.review_status === 'kept') bump(keptBy, r.user_id)
    if (r.review_status === 'discarded') bump(discardBy, r.user_id)
  }
  for (const r of drafts) {
    bump(draftBy, r.user_id)
    if (r.status === 'sent') bump(sentBy, r.user_id)
    if (r.status === 'bounced') bump(bouncedBy, r.user_id)
  }
  for (const r of chats) bump(chatBy, r.user_id)
  for (const r of gmail) gmailSet.add(r.user_id)
  for (const r of filters) {
    filterBy.set(r.user_id, featureFlags(r.filters))
  }

  const profileBy = new Map(profiles.map((p) => [p.id, p]))
  const users = authUsers.map((u) => {
    const p = profileBy.get(u.id)
    const feats = filterBy.get(u.id) || featureFlags(null)
    return {
      id: u.id,
      email: u.email,
      name: (p?.full_name || p?.display_name || '').trim() || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      orientation_complete: p?.orientation_complete === true,
      orientation_step: p?.orientation_step || null,
      resumes: resumeBy.get(u.id) || 0,
      searches: searchBy.get(u.id) || 0,
      contacts: contactBy.get(u.id) || 0,
      kept: keptBy.get(u.id) || 0,
      discarded: discardBy.get(u.id) || 0,
      drafts: draftBy.get(u.id) || 0,
      sent: sentBy.get(u.id) || 0,
      bounced: bouncedBy.get(u.id) || 0,
      chat_messages: chatBy.get(u.id) || 0,
      gmail: gmailSet.has(u.id),
      features: feats,
    }
  })

  users.sort((a, b) => (b.last_sign_in_at || b.created_at).localeCompare(
    a.last_sign_in_at || a.created_at,
  ))

  const distinct = (m: Map<string, number>) =>
    [...m.entries()].filter(([, n]) => n > 0).length

  const orientDone = users.filter((u) => u.orientation_complete).length
  const totals = {
    users: users.length,
    resumes: resumes.length,
    searches: runs.length,
    contacts: contacts.length,
    kept: [...keptBy.values()].reduce((a, b) => a + b, 0),
    discarded: [...discardBy.values()].reduce((a, b) => a + b, 0),
    drafts: drafts.length,
    sent: [...sentBy.values()].reduce((a, b) => a + b, 0),
    bounced: [...bouncedBy.values()].reduce((a, b) => a + b, 0),
    gmail_connected: gmailSet.size,
    hunter: users.filter((u) => u.features.hunter).length,
    apollo: users.filter((u) => u.features.apollo).length,
    tomba: users.filter((u) => u.features.tomba).length,
    smtp: users.filter((u) => u.features.smtp).length,
  }

  return {
    ok: true,
    totals,
    funnel: {
      signed_up: totals.users,
      orientation_complete: orientDone,
      has_resume: distinct(resumeBy),
      ran_search: distinct(searchBy),
      kept_contact: distinct(keptBy),
      drafted: distinct(draftBy),
      sent: distinct(sentBy),
    },
    users,
  }
}

async function loadUserDetail(
  admin: ReturnType<typeof adminClient>,
  userId: string,
) {
  const [{ data: profile }, { data: searchProfile }, { data: filterRows }, chat, runs] =
    await Promise.all([
      admin
        .from('profiles')
        .select(
          'display_name, full_name, orientation_complete, orientation_step, created_at, updated_at',
        )
        .eq('id', userId)
        .maybeSingle(),
      admin
        .from('search_profiles')
        .select('id, name, profile, chat_summary, updated_at')
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle(),
      admin
        .from('search_filters')
        .select('filters, search_profile_id')
        .eq('user_id', userId),
      admin
        .from('profile_chat_messages')
        .select('role, content, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(120),
      admin
        .from('search_runs')
        .select('id, status, stage, message, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(12),
    ])

  const { data: authUser } = await admin.auth.admin.getUserById(userId)
  const filterRow =
    filterRows?.find((row) => row.search_profile_id === searchProfile?.id) ||
    filterRows?.[0] ||
    null

  return {
    ok: true,
    user: {
      id: userId,
      email: authUser?.user?.email ?? null,
      name:
        (profile?.full_name || profile?.display_name || '').trim() || null,
      created_at: authUser?.user?.created_at || profile?.created_at || null,
      last_sign_in_at: authUser?.user?.last_sign_in_at ?? null,
      orientation_complete: profile?.orientation_complete === true,
      orientation_step: profile?.orientation_step || null,
      features: featureFlags(
        (filterRow?.filters || null) as Record<string, unknown> | null,
      ),
    },
    search_profile: searchProfile?.profile ?? null,
    search_profile_name: searchProfile?.name ?? null,
    chat_summary: searchProfile?.chat_summary ?? null,
    chat: chat.data || [],
    searches: runs.data || [],
  }
}
