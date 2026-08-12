/**
 * Temporary people-search looseness on company retries.
 * One ~15% aspect per empty round — does not persist niches/filters.
 */

export type LoosenAspect =
  | 'broad_titles'
  | 'dept_niche'
  | 'title_match'
  | 'location_focus'

export const LOOSEN_ASPECTS: LoosenAspect[] = [
  'broad_titles',
  'dept_niche',
  'title_match',
  'location_focus',
]

/** Fraction of loosen applied to the chosen aspect (not cumulative). */
export const LOOSEN_STRENGTH = 0.15

export type LoosenSnapshot = {
  titles: string[]
  deptKeywords: string[]
  include: string[]
  locationHint: string | null
  lightKeywords: string[]
  /** Soft keep threshold when title is not an include match (default 5). */
  minScore: number
}

function atLeastOne(n: number): number {
  return Math.max(1, n)
}

function countFor(size: number, strength = LOOSEN_STRENGTH): number {
  return atLeastOne(Math.ceil(size * strength))
}

function shuffleCopy<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/** Pick a random aspect not yet tried this company; null if all used. */
export function pickLoosenAspect(tried: string[]): LoosenAspect | null {
  const left = LOOSEN_ASPECTS.filter((a) => !tried.includes(a))
  if (left.length === 0) return null
  return left[Math.floor(Math.random() * left.length)]!
}

/**
 * Apply one temporary loosen aspect (~15%) onto a copy of search inputs.
 * Does not mutate the original plan_meta / profile niches.
 */
export function applyLoosenAspect(
  base: LoosenSnapshot,
  aspect: LoosenAspect,
  broadTitles: string[],
): LoosenSnapshot & { aspect: LoosenAspect; note: string } {
  const next: LoosenSnapshot = {
    titles: [...base.titles],
    deptKeywords: [...base.deptKeywords],
    include: [...base.include],
    locationHint: base.locationHint,
    lightKeywords: [...base.lightKeywords],
    minScore: base.minScore,
  }

  if (aspect === 'broad_titles') {
    const addN = countFor(Math.max(next.titles.length, 4))
    const pool = shuffleCopy(
      broadTitles.filter(
        (t) =>
          !next.titles.some((x) => x.toLowerCase() === t.toLowerCase()),
      ),
    )
    const added = pool.slice(0, addN)
    next.titles = [...next.titles, ...added]
    return {
      ...next,
      aspect,
      note: `+${added.length} broader title(s) (~${Math.round(LOOSEN_STRENGTH * 100)}%)`,
    }
  }

  if (aspect === 'dept_niche') {
    if (next.deptKeywords.length === 0) {
      return {
        ...next,
        aspect,
        note: 'dept niche already empty — no change',
      }
    }
    // Drop the longest / most specific niche tokens first
    const sorted = [...next.deptKeywords].sort((a, b) => b.length - a.length)
    const dropN = countFor(sorted.length)
    const drop = new Set(sorted.slice(0, dropN).map((k) => k.toLowerCase()))
    next.deptKeywords = next.deptKeywords.filter(
      (k) => !drop.has(k.toLowerCase()),
    )
    return {
      ...next,
      aspect,
      note: `dropped ${dropN} niche keyword(s) (~${Math.round(LOOSEN_STRENGTH * 100)}%)`,
    }
  }

  if (aspect === 'title_match') {
    const before = next.minScore
    next.minScore = Math.max(3, Math.round(before * (1 - LOOSEN_STRENGTH)))
    return {
      ...next,
      aspect,
      note: `softer title fit ${before}→${next.minScore} (~${Math.round(LOOSEN_STRENGTH * 100)}%)`,
    }
  }

  // location_focus — weaken geo / light project tokens
  const hadLocation = Boolean(next.locationHint?.trim())
  if (next.lightKeywords.length > 0) {
    const dropN = countFor(next.lightKeywords.length)
    const shuffled = shuffleCopy(next.lightKeywords)
    next.lightKeywords = shuffled.slice(dropN)
    // Also clear location half the time when both exist
    if (hadLocation && Math.random() < 0.5) {
      next.locationHint = null
      return {
        ...next,
        aspect,
        note: `dropped ${dropN} light keyword(s) + location (~${Math.round(LOOSEN_STRENGTH * 100)}%)`,
      }
    }
    return {
      ...next,
      aspect,
      note: `dropped ${dropN} light keyword(s) (~${Math.round(LOOSEN_STRENGTH * 100)}%)`,
    }
  }
  if (hadLocation) {
    next.locationHint = null
    return {
      ...next,
      aspect,
      note: 'dropped location focus for this pass',
    }
  }
  return {
    ...next,
    aspect,
    note: 'no location/light focus to loosen',
  }
}
