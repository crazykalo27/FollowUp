export type SearchDepth = 'quick' | 'standard' | 'deep'

/** Industry discovery queries per run (see run-search). */
const PLAN_WEB_SEARCHES = 4
/** LinkedIn + email snippet search per company (Bing preferred over Serper). */
const WEB_SEARCHES_PER_COMPANY = 2

export type DepthPreset = {
  id: SearchDepth
  /** User-facing name in credit terms */
  label: string
  companies: number
  perCompany: number
  /** Bing + Serper search API calls (upper bound) */
  webSearchCredits: number
  /** Hunter domain-search calls if Hunter enabled in Filters */
  hunterDomainCalls: number
  /** Upper bound Hunter email-finder + verifier if Hunter enabled */
  hunterMaxFindVerify: number
  eta: string
  estimatePeople: string
  blurb: string
}

function webCredits(companies: number): number {
  return PLAN_WEB_SEARCHES + companies * WEB_SEARCHES_PER_COMPANY
}

export const SEARCH_DEPTHS: DepthPreset[] = [
  {
    id: 'quick',
    label: 'Low credits',
    companies: 3,
    perCompany: 2,
    webSearchCredits: webCredits(3),
    hunterDomainCalls: 3,
    hunterMaxFindVerify: 6,
    eta: '~1–3 min',
    estimatePeople: 'up to ~6 contacts',
    blurb: 'Smallest Bing/Serper + Hunter footprint; good for testing.',
  },
  {
    id: 'standard',
    label: 'Medium credits',
    companies: 6,
    perCompany: 3,
    webSearchCredits: webCredits(6),
    hunterDomainCalls: 6,
    hunterMaxFindVerify: 18,
    eta: '~3–8 min',
    estimatePeople: 'up to ~18 contacts',
    blurb: 'Default batch size for a normal outreach run.',
  },
  {
    id: 'deep',
    label: 'High credits',
    companies: 8,
    perCompany: 4,
    webSearchCredits: webCredits(8),
    hunterDomainCalls: 8,
    hunterMaxFindVerify: 32,
    eta: '~5–12 min',
    estimatePeople: 'up to ~32 contacts',
    blurb: 'Most companies; uses the most search + Hunter quota.',
  },
]

export function depthPreset(id: SearchDepth): DepthPreset {
  return SEARCH_DEPTHS.find((d) => d.id === id) || SEARCH_DEPTHS[1]
}

const ACTIVE_RUN_KEY = 'followup_active_search_run'
const ACTIVE_DEPTH_KEY = 'followup_active_search_depth'

export function saveActiveRunDepth(depth: SearchDepth) {
  try {
    sessionStorage.setItem(ACTIVE_DEPTH_KEY, depth)
  } catch {
    // ignore
  }
}

export function loadActiveRunDepth(): SearchDepth {
  try {
    const d = sessionStorage.getItem(ACTIVE_DEPTH_KEY) as SearchDepth | null
    if (d === 'quick' || d === 'standard' || d === 'deep') return d
  } catch {
    // ignore
  }
  return 'standard'
}

export function saveActiveRunId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_RUN_KEY, id)
    else localStorage.removeItem(ACTIVE_RUN_KEY)
  } catch {
    // ignore
  }
}

export function loadActiveRunId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_RUN_KEY)
  } catch {
    return null
  }
}
