/**
 * Preference gradient descent for orientation calibration.
 *
 * Models industries / roles / outreach titles as scores in [0, 1].
 * Keep/discard reasons apply deterministic signed updates (learning rate).
 * ~10% of industry slots are reserved for exploration so the optimum is
 * approached without collapsing to a single niche too early.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { openaiChat } from './cors.ts'
import { recommendFiltersForUser } from './recommendFilters.ts'

export const EXPLORATION_RATE = 0.1
export const LEARNING_RATE = 0.35
export const TARGET_INDUSTRY_COUNT = 6
export const TARGET_ROLE_COUNT = 6

export type GradientState = {
  industries: Record<string, number>
  roles: Record<string, number>
  include_titles: Record<string, number>
  exclude_titles: Record<string, number>
  step: number
  seed: string
}

export type RefineDecision = {
  decision: 'keep' | 'discard'
  reasons: string[]
  note?: string | null
  contact_title?: string | null
  company_name?: string | null
  hiring_signal?: string | null
  match_reason?: string | null
}

export type RefineResult = {
  industries: string[]
  roles: string[]
  include_titles: string[]
  exclude_titles: string[]
  steps: string[]
  gradient: GradientState
  explored: string[]
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

function normKey(s: string) {
  return s.trim().replace(/\s+/g, ' ')
}

function unique(arr: string[]) {
  return Array.from(new Set(arr.map(normKey).filter(Boolean)))
}

/** Deterministic 0–99 from string (FNV-1a style). */
export function hashPercent(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h >>> 0) % 100
}

function sortedByScore(weights: Record<string, number>): string[] {
  return Object.entries(weights)
    .filter(([k, v]) => k.trim() && v > 0.05)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k)
}

function bump(
  weights: Record<string, number>,
  key: string | null | undefined,
  delta: number,
) {
  const k = key ? normKey(key) : ''
  if (!k) return
  const cur = weights[k] ?? 0.45
  weights[k] = clamp01(cur + delta)
}

export type PolarNote = {
  reject: string[]
  prefer: string[]
  /** True when we parsed an explicit contrast (A not B, want X not Y, …). */
  contrastive: boolean
  raw: string
}

/**
 * Interpret free-text keep/discard notes into REJECT vs PREFER niches.
 * Example: "fusion not embedded automotive" → reject fusion, prefer embedded automotive.
 */
export function parsePolarFeedbackNote(
  note: string | null | undefined,
  decision: 'keep' | 'discard' = 'discard',
): PolarNote {
  const raw = normKey(note || '')
  if (!raw) return { reject: [], prefer: [], contrastive: false, raw: '' }

  const reject: string[] = []
  const prefer: string[] = []

  const push = (arr: string[], v: string | undefined) => {
    const k = normKey(v || '')
    if (k.length >= 2 && k.length <= 80) arr.push(k)
  }

  // "want/looking for/prefer X, not Y" / "want X not Y"
  let m = raw.match(
    /(?:want|looking for|prefer|need|seeking)\s+(.+?)(?:\s*[,;:—-]+\s*|\s+)not\s+(.+)$/i,
  )
  if (m) {
    push(prefer, m[1])
    push(reject, m[2])
    return { reject: unique(reject), prefer: unique(prefer), contrastive: true, raw }
  }

  // "not X, want/looking for Y" / "not X — Y"
  m = raw.match(
    /^not\s+(.+?)(?:\s*[,;:—-]+\s*|\s+)(?:want|looking for|prefer|need|seeking|=|->)?\s*(.+)$/i,
  )
  if (m) {
    push(reject, m[1])
    push(prefer, m[2])
    return { reject: unique(reject), prefer: unique(prefer), contrastive: true, raw }
  }

  // "X instead of Y" / "X rather than Y"
  m = raw.match(/^(.+?)\s+(?:instead of|rather than)\s+(.+)$/i)
  if (m) {
    push(prefer, m[1])
    push(reject, m[2])
    return { reject: unique(reject), prefer: unique(prefer), contrastive: true, raw }
  }

  // "wrong: X; want: Y" / "reject X / prefer Y"
  m = raw.match(
    /(?:wrong|reject|avoid|dislike)\s*:?\s*(.+?)(?:\s*[,;/|]+\s*|\s+)(?:want|prefer|like|need)\s*:?\s*(.+)$/i,
  )
  if (m) {
    push(reject, m[1])
    push(prefer, m[2])
    return { reject: unique(reject), prefer: unique(prefer), contrastive: true, raw }
  }

  // Default contrast: "X not Y" (e.g. "fusion not embedded automotive")
  m = raw.match(/^(.+?)\s+not\s+(.+)$/i)
  if (m) {
    push(reject, m[1])
    push(prefer, m[2])
    return { reject: unique(reject), prefer: unique(prefer), contrastive: true, raw }
  }

  // Non-contrastive: whole note is a niche label with polarity from decision
  if (decision === 'discard') push(reject, raw)
  else push(prefer, raw)
  return {
    reject: unique(reject),
    prefer: unique(prefer),
    contrastive: false,
    raw,
  }
}

/** Human-readable polarity line for preference docs / AI memos. */
export function formatPolarNoteLine(polar: PolarNote): string {
  if (!polar.raw) return ''
  const bits: string[] = []
  if (polar.reject.length) bits.push(`REJECT niches: ${polar.reject.join('; ')}`)
  if (polar.prefer.length) bits.push(`PREFER niches: ${polar.prefer.join('; ')}`)
  if (!bits.length) return `note: ${polar.raw}`
  return `note "${polar.raw}" → ${bits.join(' | ')}`
}

/** Fallback hiring-signal / company hint when note has no usable niches. */
function extractIndustryHint(d: RefineDecision): string | null {
  if (d.hiring_signal?.trim()) {
    const s = normKey(d.hiring_signal)
    return s.length > 90 ? s.slice(0, 90) : s
  }
  if (d.company_name?.trim()) return normKey(d.company_name)
  if (d.match_reason?.trim()) {
    const s = normKey(d.match_reason)
    return s.length > 90 ? s.slice(0, 90) : s
  }
  return null
}

export function emptyGradient(seed: string): GradientState {
  return {
    industries: {},
    roles: {},
    include_titles: {},
    exclude_titles: {},
    step: 0,
    seed,
  }
}

export function seedGradientFromProfile(
  seed: string,
  profile: {
    industries?: string[]
    roles?: string[]
    outreach_targets?: string[]
  },
  prior?: Partial<GradientState> | null,
): GradientState {
  const g: GradientState = {
    industries: { ...(prior?.industries || {}) },
    roles: { ...(prior?.roles || {}) },
    include_titles: { ...(prior?.include_titles || {}) },
    exclude_titles: { ...(prior?.exclude_titles || {}) },
    step: typeof prior?.step === 'number' ? prior.step : 0,
    seed: prior?.seed || seed,
  }
  for (const ind of profile.industries || []) {
    const k = normKey(ind)
    if (k && g.industries[k] == null) g.industries[k] = 0.55
  }
  for (const role of profile.roles || []) {
    const k = normKey(role)
    if (k && g.roles[k] == null) g.roles[k] = 0.55
  }
  for (const t of profile.outreach_targets || []) {
    const k = normKey(t)
    if (k && g.include_titles[k] == null) g.include_titles[k] = 0.55
  }
  return g
}

/**
 * Apply one batch of keep/discard decisions.
 * Primary updates are deterministic given (state, decisions).
 * Exploration slots are also deterministic via hash(seed, step, slot).
 */
export function applyDecisionGradient(
  state: GradientState,
  decisions: RefineDecision[],
  lr = LEARNING_RATE,
): { state: GradientState; boosted: string[]; reduced: string[] } {
  const next: GradientState = {
    industries: { ...state.industries },
    roles: { ...state.roles },
    include_titles: { ...state.include_titles },
    exclude_titles: { ...state.exclude_titles },
    step: state.step + 1,
    seed: state.seed,
  }
  const boosted: string[] = []
  const reduced: string[] = []

  for (const d of decisions) {
    const polar = parsePolarFeedbackNote(d.note, d.decision)
    const signalHint = extractIndustryHint(d)
    const title = d.contact_title ? normKey(d.contact_title) : null
    const reasons = new Set(d.reasons || [])

    if (d.decision === 'keep') {
      const prefer =
        polar.prefer.length > 0
          ? polar.prefer
          : signalHint
            ? [signalHint]
            : []
      if (
        reasons.has('great_industry_match') ||
        polar.prefer.length > 0 ||
        reasons.size === 0
      ) {
        for (const p of prefer) {
          bump(next.industries, p, lr * 0.9)
          boosted.push(p)
        }
        for (const r of polar.reject) {
          bump(next.industries, r, -lr * 0.7)
          reduced.push(r)
        }
        // Soft-boost all current high industries slightly (momentum toward mode)
        for (const [k, v] of Object.entries(next.industries)) {
          if (v >= 0.5) next.industries[k] = clamp01(v + lr * 0.08)
        }
      }
      if (reasons.has('great_job_type_match') && title) {
        bump(next.roles, title, lr)
        bump(next.include_titles, title, lr)
        boosted.push(title)
      }
      if (reasons.has('great_hiring_connection') && title) {
        bump(next.include_titles, title, lr * 0.6)
      }
      if (reasons.has('great_application_connection') && title) {
        bump(next.include_titles, title, lr * 0.7)
        bump(next.roles, title, lr * 0.35)
      }
    } else {
      // Discard: apply contrastive note polarity first (REJECT vs PREFER)
      if (
        reasons.has('wrong_industry') ||
        polar.contrastive ||
        polar.reject.length > 0 ||
        polar.prefer.length > 0
      ) {
        const rejects =
          polar.reject.length > 0
            ? polar.reject
            : signalHint
              ? [signalHint]
              : []
        for (const r of rejects) {
          bump(next.industries, r, -lr)
          reduced.push(r)
        }
        for (const p of polar.prefer) {
          // User said they want this niche instead — boost it even on a discard
          bump(next.industries, p, lr * 0.85)
          boosted.push(p)
        }
        // Pull mass away from middling industries (sharpen the peak)
        for (const [k, v] of Object.entries(next.industries)) {
          if (v < 0.45) next.industries[k] = clamp01(v - lr * 0.12)
        }
      }
      if (reasons.has('wrong_job_type') && title) {
        bump(next.roles, title, -lr)
        bump(next.include_titles, title, -lr * 0.8)
        bump(next.exclude_titles, title, lr * 0.7)
        reduced.push(title)
      }
      if (reasons.has('not_hiring_connected') && title) {
        bump(next.include_titles, title, -lr * 0.5)
        bump(next.exclude_titles, title, lr * 0.4)
      }
    }
  }

  return { state: next, boosted: unique(boosted), reduced: unique(reduced) }
}

/** Pick top-k plus ~10% exploration slots (deterministic). */
export function selectWithExploration(
  weights: Record<string, number>,
  count: number,
  seed: string,
  step: number,
  explorers: string[],
): { selected: string[]; exploredUsed: string[] } {
  const ranked = sortedByScore(weights)
  const selected: string[] = []
  const exploredUsed: string[] = []
  let explorerIdx = 0

  for (let slot = 0; slot < count; slot++) {
    const explore = hashPercent(`${seed}:explore:${step}:${slot}`) < EXPLORATION_RATE * 100
    if (explore && explorerIdx < explorers.length) {
      const e = normKey(explorers[explorerIdx++])
      if (e && !selected.includes(e)) {
        selected.push(e)
        exploredUsed.push(e)
        continue
      }
    }
    while (ranked.length && selected.includes(ranked[0])) ranked.shift()
    if (ranked.length) selected.push(ranked.shift()!)
  }

  // Fill remaining from explorers / ranked
  for (const e of explorers) {
    if (selected.length >= count) break
    const k = normKey(e)
    if (k && !selected.includes(k)) {
      selected.push(k)
      if (!exploredUsed.includes(k)) exploredUsed.push(k)
    }
  }
  for (const r of ranked) {
    if (selected.length >= count) break
    if (!selected.includes(r)) selected.push(r)
  }

  return { selected, exploredUsed }
}

async function proposeExplorationIndustries(
  profileIndustries: string[],
  resumeSnippet: string,
  decisions: RefineDecision[],
): Promise<string[]> {
  const feedback = decisions
    .map((d) => {
      const polar = parsePolarFeedbackNote(d.note, d.decision)
      const polarLine = formatPolarNoteLine(polar)
      return `${d.decision}: ${(d.reasons || []).join(',')} @ ${d.company_name || '?'} / ${d.contact_title || '?'} / signal=${d.hiring_signal || ''}${polarLine ? ` | ${polarLine}` : ''}`
    })
    .join('\n')
    .slice(0, 2500)

  try {
    const raw = await openaiChat(
      [
        {
          role: 'system',
          content:
            'You propose SPECIFIC niche industries (not generic like "tech" or "software"). Return JSON {"industries": string[]} only. Each item should be a concrete sector niche of 3–7 words.',
        },
        {
          role: 'user',
          content: `Current niches:
${profileIndustries.join('\n') || '(none)'}

Recent keep/discard calibration:
${feedback || '(none)'}

Resume excerpt:
${resumeSnippet.slice(0, 4000) || '(none)'}

Propose 2–4 adjacent but DISTINCT specific industries to explore (10% exploration). Do not repeat current niches. Avoid generic labels.`,
        },
      ],
      { temperature: 0.55, response_format: { type: 'json_object' } },
    )
    const parsed = JSON.parse(raw) as { industries?: string[] }
    return (parsed.industries || []).map(normKey).filter((s) => s.length >= 4).slice(0, 4)
  } catch {
    return []
  }
}

function buildExplanation(opts: {
  priorIndustries: string[]
  nextIndustries: string[]
  boosted: string[]
  reduced: string[]
  explored: string[]
  keepCount: number
  discardCount: number
  topTitles: string[]
}): string[] {
  const steps: string[] = []
  steps.push(
    `Started from your stated niches: ${opts.priorIndustries.slice(0, 4).join(', ') || 'resume-seeded targets'}.`,
  )
  steps.push(
    `Calibration search reviewed ${opts.keepCount + opts.discardCount} people (${opts.keepCount} keep / ${opts.discardCount} discard).`,
  )
  if (opts.boosted.length) {
    steps.push(`Boosted matches you liked: ${opts.boosted.slice(0, 4).join(', ')}.`)
  }
  if (opts.reduced.length) {
    steps.push(`Stepped away from misfits: ${opts.reduced.slice(0, 4).join(', ')}.`)
  }
  steps.push(
    `Updated industry targets → ${opts.nextIndustries.join(', ') || '(still learning)'}.`,
  )
  if (opts.explored.length) {
    steps.push(
      `Kept ~10% exploration so we do not get stuck: trying ${opts.explored.join(', ')}.`,
    )
  } else {
    steps.push(
      `Kept ~10% exploration budget for the next pass so new niches can still surface.`,
    )
  }
  if (opts.topTitles.length) {
    steps.push(`Refined who to contact: ${opts.topTitles.slice(0, 5).join(', ')}.`)
  }
  steps.push('Next: a second search that uses these refined targets.')
  return steps
}

/** Full refine: gradient update + persist profile industries/roles + rewrite filters. */
export async function runPreferenceGradientRefine(
  admin: SupabaseClient,
  userId: string,
  decisions: RefineDecision[],
): Promise<RefineResult> {
  const [{ data: sp }, { data: pref }, { data: resume }] = await Promise.all([
    admin
      .from('search_profiles')
      .select('profile, chat_summary')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('preference_documents')
      .select('gradient_state, likes_doc, dislikes_doc, ai_summary')
      .eq('user_id', userId)
      .maybeSingle(),
    admin
      .from('resumes')
      .select('extracted_text')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const profile = (sp?.profile || {}) as {
    industries?: string[]
    roles?: string[]
    outreach_targets?: string[]
    [k: string]: unknown
  }
  const priorIndustries = [...(profile.industries || [])]
  const prior = (pref?.gradient_state || {}) as Partial<GradientState>
  let gradient = seedGradientFromProfile(userId, profile, prior)

  const { state, boosted, reduced } = applyDecisionGradient(gradient, decisions)
  gradient = state

  const explorers = await proposeExplorationIndustries(
    priorIndustries,
    resume?.extracted_text || '',
    decisions,
  )
  // Seed explorer niches at low weight so they can rise or fall later
  for (const e of explorers) {
    if (gradient.industries[e] == null) gradient.industries[e] = 0.42
  }

  const { selected: industries, exploredUsed } = selectWithExploration(
    gradient.industries,
    TARGET_INDUSTRY_COUNT,
    gradient.seed,
    gradient.step,
    explorers,
  )
  const { selected: roles } = selectWithExploration(
    gradient.roles,
    TARGET_ROLE_COUNT,
    gradient.seed,
    gradient.step + 17,
    [],
  )
  const include_titles = sortedByScore(gradient.include_titles).slice(0, 12)
  const exclude_titles = sortedByScore(gradient.exclude_titles).slice(0, 10)

  const keepCount = decisions.filter((d) => d.decision === 'keep').length
  const discardCount = decisions.filter((d) => d.decision === 'discard').length
  const steps = buildExplanation({
    priorIndustries,
    nextIndustries: industries,
    boosted,
    reduced,
    explored: exploredUsed,
    keepCount,
    discardCount,
    topTitles: include_titles,
  })

  const nextProfile = {
    ...profile,
    industries,
    roles: roles.length ? roles : profile.roles || [],
    outreach_targets: include_titles.length
      ? include_titles
      : profile.outreach_targets || [],
  }

  await admin.from('search_profiles').upsert(
    {
      user_id: userId,
      profile: nextProfile,
      chat_summary: steps.join(' '),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  await admin.from('preference_documents').upsert(
    {
      user_id: userId,
      gradient_state: gradient,
      last_refine_steps: steps,
      last_refined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  // Rewrite filters from refined profile; then pin specific title lists from gradient
  const filters = await recommendFiltersForUser(admin, userId)
  if (filters) {
    const { data: existingRow } = await admin
      .from('search_filters')
      .select('filters')
      .eq('user_id', userId)
      .maybeSingle()
    const prev = (existingRow?.filters || {}) as Record<string, unknown>
    const merged = {
      ...prev,
      ...filters,
      include_titles: include_titles.length
        ? include_titles
        : (filters.include_titles as string[]) || prev.include_titles,
      exclude_titles: Array.from(
        new Set([
          ...((filters.exclude_titles as string[]) || []),
          ...exclude_titles,
        ]),
      ).slice(0, 16),
      // Orientation second search stays small
      max_companies_per_run: 4,
      max_contacts_per_company: 1,
    }
    await admin.from('search_filters').upsert(
      {
        user_id: userId,
        filters: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  }

  return {
    industries,
    roles: roles.length ? roles : (profile.roles as string[]) || [],
    include_titles,
    exclude_titles,
    steps,
    gradient,
    explored: exploredUsed,
  }
}
