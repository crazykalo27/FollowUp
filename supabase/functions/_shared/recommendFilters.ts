import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { openaiChat } from './cors.ts'

const FILTER_SYSTEM = `You set deterministic contact search filters for FollowUp.
Return JSON only:
{
  "include_titles": string[],  // people to SEEK at target companies (8–14)
  "exclude_titles": string[],  // HR-only noise plus user dislikes (4–12)
  "locations": string[],
  "seniority": string[],
  "company_size_min": number|null,
  "company_size_max": number|null,
  "max_companies_per_run": number,
  "max_contacts_per_company": number,
  "require_verified_email": boolean,
  "accept_accept_all": boolean,
  "rationale": string
}
The profile describes what JOBS and INDUSTRIES the user wants — not their resume skills.
include_titles must come primarily from profile.outreach_targets (who to email) and roles/industries they want.
Prioritize people who refer or influence hiring: Director, Engineering Manager, Principal/Staff Engineer, Research Scientist, Senior Engineer, Lead Engineer.
Broader technical titles when aligned. Recruiter / Talent Acquisition only as low-priority includes.
exclude_titles reflect dislikes doc and patterns they discard.
locations mirror profile.locations when present.
exclude_titles: generic HR/People Ops/Staffing — do not blanket-exclude Recruiter if included.`

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
    seniority: (parsed.seniority as string[]) || ['senior', 'executive'],
    company_size_min: (parsed.company_size_min as number | null) ?? null,
    company_size_max: (parsed.company_size_max as number | null) ?? null,
    max_companies_per_run: Number(parsed.max_companies_per_run) || 6,
    max_contacts_per_company: Number(parsed.max_contacts_per_company) || 3,
    require_verified_email: parsed.require_verified_email === true,
    accept_accept_all: parsed.accept_accept_all !== false,
    rationale: (parsed.rationale as string) || '',
  }
}

/** AI writes search_filters from profile + resume + preference docs. */
export async function recommendFiltersForUser(
  admin: SupabaseClient,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const [{ data: resume }, { data: sp }, { data: pref }, { data: chat }] =
    await Promise.all([
      admin
        .from('resumes')
        .select('extracted_text, file_name')
        .eq('user_id', userId)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('search_profiles')
        .select('profile, chat_summary')
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('preference_documents')
        .select('likes_doc, dislikes_doc, ai_summary, discard_reason_counts')
        .eq('user_id', userId)
        .maybeSingle(),
      admin
        .from('profile_chat_messages')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(12),
    ])

  const profile = sp?.profile || {}
  const chatBits = (chat || [])
    .reverse()
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')
    .slice(0, 4000)
  const resumeText = (resume?.extracted_text || '').slice(0, 8000)

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

Chat summary:
${sp?.chat_summary || '(none)'}

Recent chat:
${chatBits || '(none)'}

Resume (${resume?.file_name || 'n/a'}):
${resumeText || '(none)'}

Preference AI summary:
${pref?.ai_summary || '(none yet)'}

Likes doc:
${pref?.likes_doc || '(empty)'}

Dislikes doc:
${pref?.dislikes_doc || '(empty)'}

Discard reason counts:
${JSON.stringify(pref?.discard_reason_counts || {})}`,
      },
    ],
    { temperature: 0.25, response_format: { type: 'json_object' } },
  )

  const parsed = parseFiltersJson(raw)
  const filters = normalizeFilters(parsed)

  const { data: existingRow } = await admin
    .from('search_filters')
    .select('filters')
    .eq('user_id', userId)
    .maybeSingle()
  const prev = (existingRow?.filters || {}) as Record<string, unknown>

  const preservedToggles = {
    enable_hunter: prev.enable_hunter === true,
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
    max_companies_per_run: filters.max_companies_per_run,
    max_contacts_per_company: filters.max_contacts_per_company,
    require_verified_email: filters.require_verified_email,
    accept_accept_all: filters.accept_accept_all,
    ...preservedToggles,
  }

  await admin.from('search_filters').upsert(
    {
      user_id: userId,
      filters: filtersToStore,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  return { ...filters, ...preservedToggles }
}
