import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { openaiChat } from './cors.ts'
import {
  applyTitleTuningToIncludes,
  asTermList,
  preferProfileAlignedIncludes,
  scrubProfileByRemoveTerms,
} from './peopleTitlePolicy.ts'
import {
  ensureActiveSearchProfile,
  loadResumeForProfile,
} from './searchProfile.ts'

const FILTER_SYSTEM = `You set deterministic contact search filters for FollowUp.
Return JSON only:
{
  "include_titles": string[],  // people to SEEK at target companies (8–14)
  "exclude_titles": string[],  // HR-only noise plus user dislikes (4–12)
  "locations": string[],
  "seniority": string[],
  "company_size_min": number|null,
  "company_size_max": number|null,
  "require_verified_email": boolean,
  "accept_accept_all": boolean,
  "rationale": string
}
The profile describes what JOBS and INDUSTRIES the user wants — not their resume skills.
Industries must stay SPECIFIC niches (never collapse to generic buckets like "tech" unless the profile says so).
include_titles must come primarily from profile.outreach_targets (who to email) and the roles/industries the user confirmed.
Use titles that fit THEIR niches only — do not assume software, engineering, or tech unless the profile indicates it.
Prioritize people who refer or influence hiring for those niches (managers, directors, team leads, senior practitioners in that field).
Never invent people titles the user asked to remove (see ban_terms). Prefer titles from outreach_targets / prefer_terms.
Broader titles when aligned with profile. Recruiter / Talent Acquisition only as low-priority includes.
Preference docs describe feedback on contacts (what to seek or avoid) —
NOT biographies of people. Use negative feedback to avoid bad match patterns; use positive feedback to reinforce good ones.
If discard_reason_counts includes wrong_company, that means people were attached to the wrong employer (SERP noise) — reinforce tighter company targeting, not a different industry.
If discard_reason_counts includes wrong_position_seniority, the person's level was wrong — tighten seniority (entry/mid/experienced) to the profile, do not swap industries.
locations mirror profile.locations when present.
exclude_titles: generic HR/People Ops/Staffing — do not blanket-exclude Recruiter if profile includes them.`

function parseFiltersJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function normalizeFilters(parsed: Record<string, unknown>) {
  return {
    include_titles: (parsed.include_titles as string[]) || [],
    exclude_titles: Array.from(
      new Set([
        ...((parsed.exclude_titles as string[]) || []),
        'People Ops',
        'HR Business Partner',
        'Sourcer',
        'Staffing',
      ]),
    ),
    locations: (parsed.locations as string[]) || [],
    seniority: (parsed.seniority as string[]) || [],
    company_size_min: (parsed.company_size_min as number | null) ?? null,
    company_size_max: (parsed.company_size_max as number | null) ?? null,
    require_verified_email: parsed.require_verified_email === true,
    accept_accept_all: parsed.accept_accept_all !== false,
    rationale: (parsed.rationale as string) || '',
  }
}

export type RecommendFilterOpts = {
  /** Topics/titles the user asked to drop this turn (any domain). */
  banTerms?: string[]
  /** Topics/titles the user asked to add this turn. */
  preferTerms?: string[]
  searchProfileId?: string
}

/** AI writes search_filters from profile + resume + preference docs. */
export async function recommendFiltersForUser(
  admin: SupabaseClient,
  userId: string,
  opts?: RecommendFilterOpts,
): Promise<Record<string, unknown> | null> {
  const spRow = opts?.searchProfileId
    ? (
        await admin
          .from('search_profiles')
          .select('id, profile, chat_summary, resume_id')
          .eq('user_id', userId)
          .eq('id', opts.searchProfileId)
          .maybeSingle()
      ).data
    : await ensureActiveSearchProfile(admin, userId)
  if (!spRow) return null

  const [{ data: resume }, { data: pref }, { data: chat }] =
    await Promise.all([
      loadResumeForProfile(admin, userId, spRow.resume_id),
      admin
        .from('preference_documents')
        .select('likes_doc, dislikes_doc, ai_summary, discard_reason_counts')
        .eq('search_profile_id', spRow.id)
        .maybeSingle(),
      admin
        .from('profile_chat_messages')
        .select('role, content')
        .eq('search_profile_id', spRow.id)
        .order('created_at', { ascending: false })
        .limit(12),
    ])
  const sp = { profile: spRow.profile, chat_summary: spRow.chat_summary }

  const chatBits = (chat || [])
    .reverse()
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(0, 4000)
  const resumeText = (resume?.extracted_text || '').slice(0, 8000)

  const banTerms = asTermList(opts?.banTerms)
  const preferTerms = asTermList(opts?.preferTerms)

  const profileRaw = (sp?.profile || {}) as {
    outreach_targets?: string[]
    roles?: string[]
    industries?: string[]
    must_haves?: string[]
    skills?: string[]
    [key: string]: unknown
  }
  const profile = banTerms.length
    ? scrubProfileByRemoveTerms(profileRaw, banTerms)
    : profileRaw

  if (
    banTerms.length &&
    JSON.stringify(profile.outreach_targets || []) !==
      JSON.stringify(profileRaw.outreach_targets || [])
  ) {
    await admin
      .from('search_profiles')
      .update({
        profile,
        chat_summary: sp?.chat_summary || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', spRow.id)
  }

  const raw = await openaiChat(
    [
      { role: 'system', content: FILTER_SYSTEM },
      {
        role: 'user',
        content: `Build filters for finding PEOPLE at companies aligned with this candidate's goals.

Profile fields:
- roles = job titles they WANT
- industries / company_types = where they want to work
- outreach_targets = who to email (primary source for include_titles)
- skills = resume background only (secondary)

Search profile JSON:
${JSON.stringify(profile)}

This-turn tuning (honor strictly):
- ban_terms (must NOT appear in include_titles; add to exclude_titles when people titles): ${JSON.stringify(banTerms)}
- prefer_terms (should appear in include_titles when they are people/roles): ${JSON.stringify(preferTerms)}

Chat summary:
${sp?.chat_summary || '(none)'}

Recent chat:
${chatBits || '(none)'}

Resume (${resume?.file_name || 'n/a'}):
${resumeText || '(none)'}

Preference AI summary (about which hiring signals / pick types to trust):
${pref?.ai_summary || '(none yet)'}

Positive pick-signal feedback (rewarded hiring signals + match reasons):
${pref?.likes_doc || '(empty)'}

Negative pick-signal feedback (rejected hiring signals + why):
${pref?.dislikes_doc || '(empty)'}

IMPORTANT polarity: preference docs may say "REJECT niches: …" and "PREFER niches: …".
Treat REJECT as industries/signals to avoid; PREFER as targets to reinforce — even when the PREFER line came from a discard note like "fusion not embedded automotive" (reject fusion, prefer embedded automotive).

If recent chat asked to REMOVE something from the profile/search targets, do not put that topic (or close synonyms) in include_titles / locations / seniority mirrors — rebuild from the updated profile. If they asked to ADD something, integrate it into includes when it fits who to email.
Tune to whatever niches the user wants (technical, arts, anything) — follow ban_terms / prefer_terms and the rewritten profile, do not keep stale people titles.

"Wrong company" discards mean the person did not actually work at the labeled employer — do not change industries for that; keep seeking the intended company more carefully.

"Wrong position seniority" discards mean the contact's level was off — adjust seniority filters, not industry.

Discard/keep reason counts:
${JSON.stringify(pref?.discard_reason_counts || {})}`,
      },
    ],
    { temperature: 0.25, response_format: { type: 'json_object' } },
  )

  const parsed = parseFiltersJson(raw)
  const filters = normalizeFilters(parsed)
  filters.include_titles = preferProfileAlignedIncludes(
    filters.include_titles,
    profile,
    banTerms,
  )
  filters.include_titles = applyTitleTuningToIncludes(filters.include_titles, {
    banTerms,
    preferTerms,
  })
  if (banTerms.length) {
    filters.exclude_titles = Array.from(
      new Set([...filters.exclude_titles, ...banTerms]),
    )
  }

  const { data: existingRow } = await admin
    .from('search_filters')
    .select('id, filters')
    .eq('search_profile_id', spRow.id)
    .maybeSingle()
  const prev = (existingRow?.filters || {}) as Record<string, unknown>

  const preservedToggles = {
    enable_hunter: prev.enable_hunter === true,
    enable_apollo: prev.enable_apollo === true,
    enable_tomba: prev.enable_tomba === true,
    enable_smtp_verify: prev.enable_smtp_verify === true,
    require_verified_email: prev.require_verified_email === true,
    ...(prev.accept_accept_all !== undefined
      ? { accept_accept_all: prev.accept_accept_all !== false }
      : { accept_accept_all: true }),
  }

  const filtersToStore = {
    include_titles: filters.include_titles,
    exclude_titles: filters.exclude_titles,
    locations: filters.locations,
    seniority: filters.seniority,
    company_size_min: filters.company_size_min,
    company_size_max: filters.company_size_max,
    require_verified_email: filters.require_verified_email,
    accept_accept_all: filters.accept_accept_all,
    ...preservedToggles,
  }

  if (existingRow?.id) {
    await admin
      .from('search_filters')
      .update({
        filters: filtersToStore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingRow.id)
  } else {
    await admin.from('search_filters').insert({
      user_id: userId,
      search_profile_id: spRow.id,
      filters: filtersToStore,
    })
  }

  return { ...filters, ...preservedToggles }
}
