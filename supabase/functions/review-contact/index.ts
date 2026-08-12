import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  openaiChat,
  requireUser,
} from '../_shared/cors.ts'
import { recommendFiltersForUser } from '../_shared/recommendFilters.ts'
import {
  formatPolarNoteLine,
  parsePolarFeedbackNote,
} from '../_shared/preferenceGradient.ts'

export const DISCARD_REASONS = [
  { id: 'not_a_person', label: 'Not a person' },
  { id: 'wrong_company', label: 'Wrong company' },
  { id: 'wrong_industry', label: 'Wrong industry' },
  { id: 'not_hiring_connected', label: 'Not someone connected to hiring' },
  { id: 'wrong_location', label: 'Wrong location' },
  { id: 'wrong_job_type', label: 'Wrong job type' },
  { id: 'not_interested_anymore', label: 'Not interested anymore' },
] as const

export const KEEP_REASONS = [
  { id: 'great_location', label: 'Great location' },
  { id: 'great_hiring_connection', label: 'Great hiring connection' },
  { id: 'great_application_connection', label: 'Great application connection' },
  { id: 'great_industry_match', label: 'Great industry match' },
  { id: 'great_job_type_match', label: 'Great job type match' },
] as const

const REASON_LABEL: Record<string, string> = Object.fromEntries([
  ...DISCARD_REASONS.map((r) => [r.id, r.label]),
  ...KEEP_REASONS.map((r) => [r.id, r.label]),
  ['company_mismatch', 'Wrong company'],
])

type SignalFeedback = {
  signal: string
  match_reason: string
  reasons: string[]
  decision: 'keep' | 'discard'
  note?: string
  at: string
}

type PrefBundle = {
  likes: {
    titles: string[]
    companies: string[]
    signals: string[]
    notes: string[]
    signal_feedback: SignalFeedback[]
  }
  dislikes: {
    titles: string[]
    companies: string[]
    reasons: Record<string, number>
    notes: string[]
    signal_feedback: SignalFeedback[]
  }
  likesDoc: string
  dislikesDoc: string
  reasonCounts: Record<string, number>
  aiSummary: string | null
}

function reasonLabels(reasons: string[]) {
  return reasons.map((r) => REASON_LABEL[r] || r).join(', ')
}

function extractPickSignal(contact: {
  filter_match_reason?: string | null
  source_details?: Record<string, unknown> | null
  title?: string | null
  companies?: { hiring_signal_title?: string | null } | null
}): { signal: string; matchReason: string } {
  const details = contact.source_details || {}
  const companySignal =
    (typeof details.hiring_signal === 'string' && details.hiring_signal) ||
    contact.companies?.hiring_signal_title ||
    null
  const matchReason =
    (contact.filter_match_reason || '').trim() ||
    (contact.title
      ? `title match: ${contact.title}`
      : 'unknown match reason')
  const signal =
    (companySignal || '').trim() ||
    (matchReason.includes('signal:')
      ? matchReason.split('signal:')[1]?.split(';')[0]?.trim() || matchReason
      : matchReason)
  return { signal, matchReason }
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

  const likesRaw = (pref?.likes || {}) as Record<string, unknown>
  const dislikesRaw = (pref?.dislikes || {}) as Record<string, unknown>

  const likes = {
    titles: (likesRaw.titles as string[]) || [],
    companies: (likesRaw.companies as string[]) || [],
    signals: (likesRaw.signals as string[]) || [],
    notes: (likesRaw.notes as string[]) || [],
    signal_feedback: (likesRaw.signal_feedback as SignalFeedback[]) || [],
  }
  const dislikes = {
    titles: (dislikesRaw.titles as string[]) || [],
    companies: (dislikesRaw.companies as string[]) || [],
    reasons: (dislikesRaw.reasons as Record<string, number>) || {},
    notes: (dislikesRaw.notes as string[]) || [],
    signal_feedback: (dislikesRaw.signal_feedback as SignalFeedback[]) || [],
  }

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
  bundle.likesDoc = bundle.likesDoc.split('\n').slice(-100).join('\n')
  bundle.dislikesDoc = bundle.dislikesDoc.split('\n').slice(-100).join('\n')
  bundle.likes.signal_feedback = bundle.likes.signal_feedback.slice(-40)
  bundle.dislikes.signal_feedback = bundle.dislikes.signal_feedback.slice(-40)

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

function appendSignalFeedback(
  bundle: PrefBundle,
  decision: 'keep' | 'discard',
  entry: SignalFeedback,
  stamp: string,
) {
  const why = entry.reasons.length
    ? reasonLabels(entry.reasons)
    : decision === 'keep'
      ? 'kept (no reason chip)'
      : 'discarded'
  const polar = parsePolarFeedbackNote(entry.note, decision)
  const polarLine = formatPolarNoteLine(polar)
  const line =
    `[${stamp}] ${decision.toUpperCase()} pick_signal: "${entry.signal}"` +
    `\n  match: ${entry.match_reason}` +
    `\n  feedback: ${why}` +
    (polarLine
      ? `\n  ${polarLine}`
      : entry.note
        ? `\n  note: ${entry.note}`
        : '')

  if (decision === 'keep') {
    bundle.likes.signal_feedback.push(entry)
    if (entry.signal && !bundle.likes.signals.includes(entry.signal)) {
      bundle.likes.signals.push(entry.signal)
    }
    bundle.likesDoc = `${bundle.likesDoc}\n${line}`.trim()
    if (entry.note) bundle.likes.notes.push(entry.note)
    for (const p of polar.prefer) {
      if (!bundle.likes.signals.includes(`prefer:${p}`)) {
        bundle.likes.signals.push(`prefer:${p}`)
      }
    }
  } else {
    bundle.dislikes.signal_feedback.push(entry)
    for (const r of entry.reasons) {
      bundle.reasonCounts[r] = (bundle.reasonCounts[r] || 0) + 1
      bundle.dislikes.reasons[r] = (bundle.dislikes.reasons[r] || 0) + 1
    }
    bundle.dislikesDoc = `${bundle.dislikesDoc}\n${line}`.trim()
    if (entry.note) bundle.dislikes.notes.push(entry.note)
    for (const r of polar.reject) {
      if (!bundle.dislikes.notes.includes(`reject:${r}`)) {
        bundle.dislikes.notes.push(`reject:${r}`)
      }
    }
    // Preferred niches mentioned on a discard still count as positive intent
    for (const p of polar.prefer) {
      if (!bundle.likes.signals.includes(`prefer:${p}`)) {
        bundle.likes.signals.push(`prefer:${p}`)
      }
      const preferLine = `[${stamp}] IMPLIED PREFER from discard note: "${p}" (user rejected contrasting niche)`
      bundle.likesDoc = `${bundle.likesDoc}\n${preferLine}`.trim()
    }
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
          content: `You maintain a short preference memo for FollowUp's contact picker.
Focus on PICK SIGNALS (job posts / hiring signals / match reasons) and INDUSTRY NICHES, not individual people.
User notes may be contrastive — parse polarity carefully:
- "fusion not embedded automotive" means REJECT fusion / PREFER embedded automotive (not the reverse).
- Lines marked REJECT niches / PREFER niches are authoritative.
Explain which niches and hiring-signal patterns to prefer or avoid, and why.
4–8 concrete sentences. Plain text only.`,
        },
        {
          role: 'user',
          content: `Update this preference memo about which niches and pick signals to trust.

Current summary:
${bundle.aiSummary || '(none yet)'}

POSITIVE SIGNAL FEEDBACK (includes IMPLIED PREFER from contrastive discard notes):
${bundle.likesDoc || '(empty)'}

NEGATIVE SIGNAL FEEDBACK (REJECT niches are things to avoid):
${bundle.dislikesDoc || '(empty)'}

Latest: ${latestLine}

Return plain text only — the updated memo. Be explicit about which niches are positive vs negative.`,
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
    const contactAction = body.action as
      | 'archive'
      | 'delete'
      | 'restore'
      | undefined
    const decision = body.decision as 'keep' | 'discard' | undefined
    const reasons = (body.reasons || []) as string[]
    const note = typeof body.note === 'string' ? body.note.trim() : ''

    if (!contactId) {
      return errorResponse('contact_id required')
    }

    const { data: contact, error: cErr } = await admin
      .from('contacts')
      .select(
        'id, full_name, title, email, company_id, filter_match_reason, source_details, companies(id, name, domain, hiring_signal_title)',
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
    const pick = extractPickSignal({
      filter_match_reason: contact.filter_match_reason,
      source_details: contact.source_details as Record<string, unknown> | null,
      title: contact.title,
      companies: company,
    })

    if (
      contactAction === 'archive' ||
      contactAction === 'delete' ||
      contactAction === 'restore'
    ) {
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
      } else if (contactAction === 'restore') {
        const { data: restored, error: restoreErr } = await admin
          .from('contacts')
          .update({ review_status: 'kept' })
          .eq('id', contactId)
          .eq('user_id', user.id)
          .eq('review_status', 'archived')
          .select('id')
          .maybeSingle()

        if (restoreErr) {
          return errorResponse(restoreErr.message, 500)
        }
        if (!restored) {
          return errorResponse('Archived contact not found', 404)
        }
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
          .select(
            'id, filter_match_reason, source_details, title, companies(hiring_signal_title)',
          )
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
              reasons: ['wrong_company'],
              note: 'discard all contacts at company',
            })),
          )
        }

        // Feedback is on the company hiring signal, not each person
        appendSignalFeedback(
          bundle,
          'discard',
          {
            signal: pick.signal || companyName,
            match_reason: `company-wide discard @ ${companyName}`,
            reasons: ['wrong_company'],
            decision: 'discard',
            note: `discard all contacts at company (${pendingIds.length})`,
            at: stamp,
          },
          stamp,
        )
        if (companyName && !bundle.dislikes.companies.includes(companyName)) {
          bundle.dislikes.companies.push(companyName)
        }
        bundle.likes.companies = bundle.likes.companies.filter(
          (c) => c.toLowerCase() !== companyName.toLowerCase(),
        )

        await maybeRefreshAiSummary(
          admin,
          user.id,
          bundle,
          `discard all pick signals at ${companyName}`,
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

      appendSignalFeedback(
        bundle,
        'keep',
        {
          signal: pick.signal || companyName,
          match_reason: `favorite company @ ${companyName}`,
          reasons: ['great_industry_match', 'great_hiring_connection'],
          decision: 'keep',
          note: note || undefined,
          at: stamp,
        },
        stamp,
      )
      if (companyName && !bundle.likes.companies.includes(companyName)) {
        bundle.likes.companies.push(companyName)
      }
      bundle.dislikes.companies = bundle.dislikes.companies.filter(
        (c) => c.toLowerCase() !== companyName.toLowerCase(),
      )

      await maybeRefreshAiSummary(
        admin,
        user.id,
        bundle,
        `favorite pick signal at ${companyName}`,
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

    await admin.from('contact_decisions').insert({
      user_id: user.id,
      contact_id: contactId,
      decision,
      reasons: decision === 'discard' || decision === 'keep' ? reasons : [],
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

    appendSignalFeedback(
      bundle,
      decision,
      {
        signal: pick.signal,
        match_reason: pick.matchReason,
        reasons,
        decision,
        note: note || undefined,
        at: stamp,
      },
      stamp,
    )

    // Wrong company → learn to avoid attaching this employer (or false hits under it)
    if (
      decision === 'discard' &&
      reasons.includes('wrong_company') &&
      companyName
    ) {
      if (!bundle.dislikes.companies.includes(companyName)) {
        bundle.dislikes.companies.push(companyName)
      }
      const line = `${stamp} | Wrong company: contact was not actually at ${companyName}${
        contact.title ? ` (listed as “${contact.title}”)` : ''
      }`
      bundle.dislikesDoc = `${bundle.dislikesDoc}\n${line}`.trim()
    }

    await maybeRefreshAiSummary(
      admin,
      user.id,
      bundle,
      `${decision} pick_signal "${pick.signal}" → ${reasonLabels(reasons) || 'no chips'}`,
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
      pick_signal: pick.signal,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
