import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  openaiChat,
  requireUser,
} from '../_shared/cors.ts'
import { recommendFiltersForUser } from '../_shared/recommendFilters.ts'

export const DISCARD_REASONS = [
  { id: 'recruiter_hr', label: 'Recruiter / HR — not a hiring manager' },
  { id: 'wrong_seniority', label: 'Wrong seniority' },
  { id: 'wrong_role', label: 'Role / title isn’t what I want' },
  { id: 'wrong_industry', label: 'Wrong industry or company type' },
  { id: 'wrong_location', label: 'Location doesn’t work' },
  { id: 'not_hiring_manager', label: 'Doesn’t seem to hire for my roles' },
  { id: 'company_mismatch', label: 'Company isn’t a fit' },
  { id: 'other', label: 'Other' },
] as const

type PrefBundle = {
  likes: {
    titles: string[]
    companies: string[]
    signals: string[]
    notes: string[]
  }
  dislikes: {
    titles: string[]
    companies: string[]
    reasons: Record<string, number>
    notes: string[]
  }
  likesDoc: string
  dislikesDoc: string
  reasonCounts: Record<string, number>
  aiSummary: string | null
}

async function loadPreferenceBundle(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ pref: Record<string, unknown>; bundle: PrefBundle }> {
  let { data: pref } = await admin
    .from('preference_documents')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (!pref) {
    const { data: created } = await admin
      .from('preference_documents')
      .insert({ user_id: userId })
      .select('*')
      .single()
    pref = created
  }

  const likes = (pref?.likes || {
    titles: [],
    companies: [],
    signals: [],
    notes: [],
  }) as PrefBundle['likes']
  const dislikes = (pref?.dislikes || {
    titles: [],
    companies: [],
    reasons: {},
    notes: [],
  }) as PrefBundle['dislikes']

  return {
    pref: pref || {},
    bundle: {
      likes,
      dislikes,
      likesDoc: pref?.likes_doc || '',
      dislikesDoc: pref?.dislikes_doc || '',
      reasonCounts: {
        ...((pref?.discard_reason_counts || {}) as Record<string, number>),
      },
      aiSummary: pref?.ai_summary || null,
    },
  }
}

async function savePreferenceBundle(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  bundle: PrefBundle,
) {
  bundle.likesDoc = bundle.likesDoc.split('\n').slice(-80).join('\n')
  bundle.dislikesDoc = bundle.dislikesDoc.split('\n').slice(-80).join('\n')

  await admin.from('preference_documents').upsert({
    user_id: userId,
    likes: bundle.likes,
    dislikes: bundle.dislikes,
    likes_doc: bundle.likesDoc,
    dislikes_doc: bundle.dislikesDoc,
    discard_reason_counts: bundle.reasonCounts,
    ai_summary: bundle.aiSummary,
    updated_at: new Date().toISOString(),
  })
}

async function savePreferencesAndSyncFilters(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  bundle: PrefBundle,
) {
  await savePreferenceBundle(admin, userId, bundle)
  try {
    await recommendFiltersForUser(admin, userId)
  } catch {
    // preference save succeeded; filter sync is best-effort
  }
}

async function maybeRefreshAiSummary(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  bundle: PrefBundle,
  latestLine: string,
) {
  const { count } = await admin
    .from('contact_decisions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if ((count || 0) % 3 !== 0) return

  try {
    const raw = await openaiChat(
      [
        {
          role: 'system',
          content:
            'You maintain a short preference memo for a job-seeker’s outreach targets. 4–8 sentences. Be concrete about titles to seek/avoid and company types they want vs avoid.',
        },
        {
          role: 'user',
          content: `Update this preference memo.

Current summary:
${bundle.aiSummary || '(none yet)'}

LIKES DOC:
${bundle.likesDoc || '(empty)'}

DISLIKES DOC:
${bundle.dislikesDoc || '(empty)'}

Latest: ${latestLine}

Return plain text only — the updated memo.`,
        },
      ],
      { temperature: 0.3 },
    )
    bundle.aiSummary = raw.trim()
  } catch {
    // keep prior
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

    const body = await req.json()
    const contactId = body.contact_id as string
    const companyAction = body.company_action as 'discard_all' | 'favorite' | undefined
    const contactAction = body.action as 'archive' | 'delete' | undefined
    const decision = body.decision as 'keep' | 'discard' | undefined
    const reasons = (body.reasons || []) as string[]
    const note = typeof body.note === 'string' ? body.note.trim() : ''

    if (!contactId) {
      return errorResponse('contact_id required')
    }

    const { data: contact, error: cErr } = await admin
      .from('contacts')
      .select(
        'id, full_name, title, email, company_id, companies(id, name, domain, hiring_signal_title)',
      )
      .eq('id', contactId)
      .eq('user_id', user.id)
      .single()

    if (cErr || !contact) return errorResponse('Contact not found', 404)

    const company = Array.isArray(contact.companies)
      ? contact.companies[0]
      : contact.companies
    const companyId = contact.company_id as string
    const companyName = company?.name || 'Unknown company'
    const stamp = new Date().toISOString().slice(0, 10)

    if (contactAction === 'archive' || contactAction === 'delete') {
      if (contactAction === 'archive') {
        await admin
          .from('contacts')
          .update({ review_status: 'archived' })
          .eq('id', contactId)
          .eq('user_id', user.id)

        await admin.from('contact_decisions').insert({
          user_id: user.id,
          contact_id: contactId,
          decision: 'archive',
          reasons: [],
          note: note || null,
        })
      } else {
        await admin
          .from('contacts')
          .delete()
          .eq('id', contactId)
          .eq('user_id', user.id)
      }

      return jsonResponse({
        ok: true,
        action: contactAction,
        contact_id: contactId,
      })
    }

    if (companyAction === 'discard_all' || companyAction === 'favorite') {
      const { bundle } = await loadPreferenceBundle(admin, user.id)

      if (companyAction === 'discard_all') {
        await admin
          .from('companies')
          .update({ user_flag: 'avoid' })
          .eq('id', companyId)
          .eq('user_id', user.id)

        const { data: pendingRows } = await admin
          .from('contacts')
          .select('id')
          .eq('user_id', user.id)
          .eq('company_id', companyId)
          .eq('review_status', 'pending')

        const pendingIds = (pendingRows || []).map((r) => r.id)
        if (pendingIds.length > 0) {
          await admin
            .from('contacts')
            .update({ review_status: 'discarded' })
            .eq('user_id', user.id)
            .eq('company_id', companyId)
            .eq('review_status', 'pending')

          await admin.from('contact_decisions').insert(
            pendingIds.map((id) => ({
              user_id: user.id,
              contact_id: id,
              decision: 'discard',
              reasons: ['company_mismatch'],
              note: 'discard all contacts at company',
            })),
          )
        }

        if (companyName && !bundle.dislikes.companies.includes(companyName)) {
          bundle.dislikes.companies.push(companyName)
        }
        bundle.reasonCounts.company_mismatch =
          (bundle.reasonCounts.company_mismatch || 0) + 1
        bundle.dislikes.reasons.company_mismatch =
          (bundle.dislikes.reasons.company_mismatch || 0) + 1
        const line = `[${stamp}] DISCARD ALL @ ${companyName} (${pendingIds.length} contacts)`
        bundle.dislikesDoc = `${bundle.dislikesDoc}\n${line}`.trim()

        bundle.likes.companies = bundle.likes.companies.filter(
          (c) => c.toLowerCase() !== companyName.toLowerCase(),
        )

        await maybeRefreshAiSummary(
          admin,
          user.id,
          bundle,
          `discard all at ${companyName}`,
        )
        await savePreferencesAndSyncFilters(admin, user.id, bundle)

        const { count: pending } = await admin
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('review_status', 'pending')

        return jsonResponse({
          ok: true,
          company_action: companyAction,
          company_id: companyId,
          contacts_discarded: pendingIds.length,
          pending_remaining: pending || 0,
          preference_summary: bundle.aiSummary,
        })
      }

      await admin
        .from('companies')
        .update({ user_flag: 'favorite' })
        .eq('id', companyId)
        .eq('user_id', user.id)

      if (companyName && !bundle.likes.companies.includes(companyName)) {
        bundle.likes.companies.push(companyName)
      }
      if (company?.hiring_signal_title) {
        bundle.likes.signals.push(company.hiring_signal_title)
      }
      const line = `[${stamp}] FAVORITE COMPANY ${companyName}`
      bundle.likesDoc = `${bundle.likesDoc}\n${line}`.trim()
      if (note) {
        bundle.likes.notes.push(note)
        bundle.likesDoc += `\n  note: ${note}`
      }

      bundle.dislikes.companies = bundle.dislikes.companies.filter(
        (c) => c.toLowerCase() !== companyName.toLowerCase(),
      )

      await maybeRefreshAiSummary(
        admin,
        user.id,
        bundle,
        `favorite company ${companyName}`,
      )
      await savePreferencesAndSyncFilters(admin, user.id, bundle)

      const { count: pending } = await admin
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('review_status', 'pending')

      return jsonResponse({
        ok: true,
        company_action: companyAction,
        company_id: companyId,
        pending_remaining: pending || 0,
        preference_summary: bundle.aiSummary,
      })
    }

    if (!decision || (decision !== 'keep' && decision !== 'discard')) {
      return errorResponse('decision (keep|discard) or company_action required')
    }
    if (decision === 'discard' && reasons.length === 0 && !note) {
      return errorResponse('Pick at least one reason when discarding')
    }

    const title = contact.title || 'unknown title'
    const person = contact.full_name || 'Unknown'

    await admin.from('contact_decisions').insert({
      user_id: user.id,
      contact_id: contactId,
      decision,
      reasons:
        decision === 'discard' || decision === 'keep' ? reasons : [],
      note: note || null,
    })

    await admin
      .from('contacts')
      .update({
        review_status: decision === 'keep' ? 'kept' : 'discarded',
      })
      .eq('id', contactId)
      .eq('user_id', user.id)

    const { bundle } = await loadPreferenceBundle(admin, user.id)

    if (decision === 'keep') {
      if (title && !bundle.likes.titles.includes(title)) {
        bundle.likes.titles.push(title)
      }
      if (companyName && !bundle.likes.companies.includes(companyName)) {
        bundle.likes.companies.push(companyName)
      }
      if (company?.hiring_signal_title) {
        bundle.likes.signals.push(company.hiring_signal_title)
      }
      const line = `[${stamp}] KEEP ${person} — ${title} @ ${companyName}`
      bundle.likesDoc = `${bundle.likesDoc}\n${line}`.trim()
      if (reasons.length > 0) {
        bundle.likesDoc += `\n  why: ${reasons.join(', ')}`
      }
      if (note) {
        bundle.likes.notes.push(note)
        bundle.likesDoc += `\n  note: ${note}`
      }
    } else {
      if (title) bundle.dislikes.titles.push(title)
      if (companyName) bundle.dislikes.companies.push(companyName)
      for (const r of reasons) {
        bundle.reasonCounts[r] = (bundle.reasonCounts[r] || 0) + 1
        bundle.dislikes.reasons[r] = (bundle.dislikes.reasons[r] || 0) + 1
      }
      const reasonLabels = reasons.join(', ')
      const line = `[${stamp}] DISCARD ${person} — ${title} @ ${companyName} (${reasonLabels})`
      bundle.dislikesDoc = `${bundle.dislikesDoc}\n${line}`.trim()
      if (note) {
        bundle.dislikes.notes.push(note)
        bundle.dislikesDoc += `\n  note: ${note}`
      }
    }

    await maybeRefreshAiSummary(
      admin,
      user.id,
      bundle,
      `${decision} ${person} @ ${companyName}`,
    )
    await savePreferencesAndSyncFilters(admin, user.id, bundle)

    const { count: pending } = await admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('review_status', 'pending')

    return jsonResponse({
      ok: true,
      decision,
      pending_remaining: pending || 0,
      preference_summary: bundle.aiSummary,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
