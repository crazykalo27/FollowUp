/** Guided first-run orientation: progressive page unlock until a draft exists. */

export type OrientationStep =
  | 'welcome'
  | 'profile'
  | 'filters'
  | 'search'
  | 'contacts'
  | 'drafts'
  | 'complete'

export type AppPage =
  | 'profile'
  | 'filters'
  | 'search'
  | 'contacts'
  | 'drafts'
  | 'settings'

export const ORIENTATION_STEPS: OrientationStep[] = [
  'welcome',
  'profile',
  'filters',
  'search',
  'contacts',
  'drafts',
  'complete',
]

export const STEP_LABELS: Record<OrientationStep, string> = {
  welcome: 'Welcome',
  profile: 'Build your profile',
  filters: 'Review filters',
  search: 'Run a search',
  contacts: 'Keep a contact',
  drafts: 'Generate a draft',
  complete: 'Ready',
}

/** Pages unlocked at each step (inclusive of earlier unlocks). */
const UNLOCKS: Record<OrientationStep, AppPage[]> = {
  welcome: [],
  profile: ['profile'],
  filters: ['profile', 'filters'],
  search: ['profile', 'filters', 'search'],
  contacts: ['profile', 'filters', 'search', 'contacts'],
  drafts: ['profile', 'filters', 'search', 'contacts', 'drafts'],
  complete: ['profile', 'filters', 'search', 'contacts', 'drafts', 'settings'],
}

export function pagesForStep(step: OrientationStep): Set<AppPage> {
  return new Set(UNLOCKS[step] || UNLOCKS.profile)
}

export function isPageUnlocked(step: OrientationStep, page: AppPage): boolean {
  if (step === 'complete') return true
  return pagesForStep(step).has(page)
}

export function stepIndex(step: OrientationStep): number {
  const i = ORIENTATION_STEPS.indexOf(step)
  return i < 0 ? 0 : i
}

export function progressFraction(step: OrientationStep): number {
  if (step === 'complete') return 1
  // welcome → drafts = 6 active steps (index 0..5); complete is 100%
  const active = ORIENTATION_STEPS.length - 1
  return Math.min(1, stepIndex(step) / active)
}

export function pathForStep(step: OrientationStep): string {
  switch (step) {
    case 'welcome':
      return '/app/welcome'
    case 'profile':
      return '/app/onboarding'
    case 'filters':
      return '/app/filters'
    case 'search':
      return '/app/search'
    case 'contacts':
      return '/app/contacts'
    case 'drafts':
      return '/app/drafts'
    case 'complete':
      return '/app/search'
  }
}

export function pageFromPath(pathname: string): AppPage | 'welcome' | null {
  if (pathname.includes('/welcome')) return 'welcome'
  if (pathname.includes('/onboarding')) return 'profile'
  if (pathname.includes('/filters')) return 'filters'
  if (pathname.includes('/contacts')) return 'contacts'
  if (pathname.includes('/drafts')) return 'drafts'
  if (pathname.includes('/settings')) return 'settings'
  if (pathname.endsWith('/app') || pathname.endsWith('/app/') || pathname.includes('/search')) {
    return 'search'
  }
  return null
}

export type OrientationFacts = {
  orientation_complete: boolean
  orientation_step: OrientationStep | string | null
  profile_setup_complete: boolean
  onboarding_complete: boolean
  has_resume: boolean
  has_kept_contact: boolean
  has_draft: boolean
  has_search_with_contacts: boolean
  filters_continued: boolean
}

/**
 * Prefer stored step, but never go backwards relative to durable facts.
 * Existing users with a draft are complete.
 */
export function deriveOrientationStep(facts: OrientationFacts): OrientationStep {
  if (facts.orientation_complete || facts.has_draft) return 'complete'
  if (!facts.profile_setup_complete) return 'welcome'

  const stored = normalizeStep(facts.orientation_step)

  let derived: OrientationStep = 'profile'
  if (facts.onboarding_complete) derived = 'filters'
  if (facts.filters_continued || (facts.onboarding_complete && facts.has_search_with_contacts)) {
    // filters_continued is explicit; search-with-contacts implies they passed filters
    if (facts.filters_continued) derived = 'search'
  }
  if (facts.has_search_with_contacts) derived = 'contacts'
  if (facts.has_kept_contact) derived = 'drafts'

  // Advance stored step if facts are ahead; never regress past stored if still valid
  if (stepIndex(derived) > stepIndex(stored)) return derived
  // If stored is ahead of derived but facts don't support it, clamp to derived
  // Exception: allow stored filters/search before search facts exist
  if (stored === 'filters' && facts.onboarding_complete) return 'filters'
  if (stored === 'search' && facts.onboarding_complete && facts.filters_continued) {
    return 'search'
  }
  if (stored === 'contacts' && facts.has_search_with_contacts) return 'contacts'
  if (stored === 'drafts' && facts.has_kept_contact) return 'drafts'
  if (stored === 'profile') return 'profile'

  return derived
}

function normalizeStep(raw: string | null | undefined): OrientationStep {
  if (!raw) return 'profile'
  if ((ORIENTATION_STEPS as string[]).includes(raw)) return raw as OrientationStep
  return 'profile'
}

export function nextStepAfter(step: OrientationStep): OrientationStep {
  const i = stepIndex(step)
  return ORIENTATION_STEPS[Math.min(ORIENTATION_STEPS.length - 1, i + 1)]
}
