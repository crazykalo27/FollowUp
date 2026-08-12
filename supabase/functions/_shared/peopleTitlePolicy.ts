/** Normalize free-text terms the user wants removed or added. */
export function asTermList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (typeof item !== 'string') continue
    const t = item.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * Soft synonym expansion for a user-provided remove/add term.
 * Only expands terms the user (or model) already named — not a hardcoded ban list.
 */
export function expandTermSynonyms(term: string): string[] {
  const t = term.trim().toLowerCase()
  if (!t) return []
  const extras: string[] = []
  if (/\bfounders?\b/.test(t) || t === 'founder') {
    extras.push('founder', 'co-founder', 'cofounder', 'co founder')
  }
  if (/\bceos?\b/.test(t) || t === 'ceo' || /chief executive/.test(t)) {
    extras.push('ceo', 'chief executive', 'chief executive officer')
  }
  if (/entrepreneur/.test(t)) {
    extras.push('entrepreneur', 'entrepreneurs', 'entrepreneurship')
  }
  return Array.from(new Set([term.trim(), ...extras]))
}

export function expandAllTerms(terms: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const term of terms) {
    for (const e of expandTermSynonyms(term)) {
      const key = e.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(e)
    }
  }
  return out
}

/** True if a list item matches a remove/add term (word or phrase containment). */
export function itemMatchesTerm(item: string, term: string): boolean {
  const a = item.toLowerCase().trim()
  const b = term.toLowerCase().trim()
  if (!a || !b) return false
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  // Word-boundary-ish match for short tokens (ceo, art, …)
  const esc = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i').test(a)
}

export function itemMatchesAnyTerm(item: string, terms: string[]): boolean {
  return terms.some((t) => itemMatchesTerm(item, t))
}

export function withoutMatchingTerms(
  titles: string[],
  removeTerms: string[],
): string[] {
  const expanded = expandAllTerms(removeTerms)
  if (!expanded.length) return titles
  return titles.filter((t) => !itemMatchesAnyTerm(t, expanded))
}

export function ensureTermsPresent(
  titles: string[],
  addTerms: string[],
): string[] {
  const out = [...titles]
  const have = new Set(out.map((t) => t.toLowerCase().trim()))
  for (const term of addTerms) {
    const key = term.toLowerCase().trim()
    if (!key || have.has(key)) continue
    if (out.some((t) => itemMatchesTerm(t, term))) continue
    out.push(term.trim())
    have.add(key)
  }
  return out
}

type ListProfile = {
  roles?: string[]
  industries?: string[]
  company_types?: string[]
  outreach_targets?: string[]
  skills?: string[]
  locations?: string[]
  employment_types?: string[]
  must_haves?: string[]
  [key: string]: unknown
}

const LIST_KEYS = [
  'roles',
  'industries',
  'company_types',
  'outreach_targets',
  'skills',
  'locations',
  'employment_types',
  'must_haves',
] as const

/** Drop any list items that match remove_terms (any domain the user rejected). */
export function scrubProfileByRemoveTerms<T extends ListProfile>(
  profile: T,
  removeTerms: string[],
): T {
  const expanded = expandAllTerms(removeTerms)
  if (!expanded.length) return profile
  const next: ListProfile = { ...profile }
  for (const key of LIST_KEYS) {
    const cur = profile[key]
    if (!Array.isArray(cur)) continue
    next[key] = withoutMatchingTerms(cur as string[], expanded)
  }
  return next as T
}

/**
 * Ensure add_terms land in People to find / roles when the model forgot.
 * Heuristic: shorter niche phrases → industries; person/job-like → outreach + roles.
 */
export function ensureProfileAdditions<T extends ListProfile>(
  profile: T,
  addTerms: string[],
): T {
  if (!addTerms.length) return profile
  const next: ListProfile = { ...profile }
  const roles = [...(profile.roles || [])]
  const outreach = [...(profile.outreach_targets || [])]
  const industries = [...(profile.industries || [])]

  for (const term of addTerms) {
    const lower = term.toLowerCase()
    const looksIndustry =
      /painting|art|gallery|museum|industry|sector|computing|semiconductor|quantum|hardware|software|finance|health|biotech|climate|energy/.test(
        lower,
      ) && !/engineer|manager|director|curator|artist|designer|scientist/.test(lower)
    if (looksIndustry) {
      if (!industries.some((t) => itemMatchesTerm(t, term))) industries.push(term)
    } else {
      if (!roles.some((t) => itemMatchesTerm(t, term))) roles.push(term)
      if (!outreach.some((t) => itemMatchesTerm(t, term))) outreach.push(term)
    }
  }

  next.roles = roles
  next.outreach_targets = outreach
  next.industries = industries
  return next as T
}

/** Strip include titles that match banned terms; optionally seed preferred ones. */
export function applyTitleTuningToIncludes(
  includeTitles: string[],
  opts: { banTerms?: string[]; preferTerms?: string[] },
): string[] {
  let next = withoutMatchingTerms(includeTitles, opts.banTerms || [])
  next = ensureTermsPresent(next, opts.preferTerms || [])
  return next
}

/** Prefer include titles that still align with outreach/roles after a rewrite. */
export function preferProfileAlignedIncludes(
  includeTitles: string[],
  profile: { outreach_targets?: string[]; roles?: string[] },
  banTerms: string[] = [],
): string[] {
  const banned = expandAllTerms(banTerms)
  const seeds = [
    ...(profile.outreach_targets || []),
    ...(profile.roles || []),
  ].filter((t) => !itemMatchesAnyTerm(t, banned))

  let next = withoutMatchingTerms(includeTitles, banned)
  // Drop includes that conflict with seeds only when banTerms said so; keep other niche managers.
  if (seeds.length) {
    next = ensureTermsPresent(next, seeds.slice(0, 8))
  }
  return next
}
