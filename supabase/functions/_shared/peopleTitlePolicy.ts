/** Founder / CEO / entrepreneur-style titles — not default "people to find". */
const FOUNDER_CEO_RE =
  /\b(co-?founders?|founders?|ceos?|chief executive(?:\s+officer)?s?|entrepreneurs?)\b/i

export function isFounderCeoEntrepreneurTitle(title: string): boolean {
  return FOUNDER_CEO_RE.test(title.trim())
}

export function withoutFounderCeoEntrepreneur(titles: string[]): string[] {
  return titles.filter((t) => !isFounderCeoEntrepreneurTitle(t))
}

/** True when the user asked to drop founder/CEO/entrepreneur-style people targets. */
export function messageRequestsDropFounderCeo(message: string): boolean {
  const m = message.toLowerCase()
  const mentions = /\b(founder|ceo|entrepreneur|co-founder|cofounder|chief executive)\b/.test(
    m,
  )
  const drop =
    /\b(remove|drop|delete|without|no more|get rid|don't want|do not want|dont want|stop|exclude|gone|off my|out of|take off|strip)\b/.test(
      m,
    )
  return mentions && drop
}

export function scrubFounderCeoFromProfileFields<
  T extends {
    roles?: string[]
    outreach_targets?: string[]
    must_haves?: string[]
    skills?: string[]
  },
>(profile: T): T {
  return {
    ...profile,
    roles: withoutFounderCeoEntrepreneur(profile.roles || []),
    outreach_targets: withoutFounderCeoEntrepreneur(profile.outreach_targets || []),
    must_haves: withoutFounderCeoEntrepreneur(profile.must_haves || []),
    skills: withoutFounderCeoEntrepreneur(profile.skills || []),
  }
}

/**
 * Keep founder/CEO/entrepreneur include titles only when the profile still lists them
 * as outreach/role targets (user explicitly wants them).
 */
export function filterIncludeTitlesAgainstProfile(
  includeTitles: string[],
  profile: { outreach_targets?: string[]; roles?: string[] },
): string[] {
  const allowed = new Set(
    [...(profile.outreach_targets || []), ...(profile.roles || [])]
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean),
  )
  return includeTitles.filter((t) => {
    if (!isFounderCeoEntrepreneurTitle(t)) return true
    const key = t.toLowerCase().trim()
    return (
      allowed.has(key) ||
      [...allowed].some((a) => a.includes(key) || key.includes(a))
    )
  })
}
