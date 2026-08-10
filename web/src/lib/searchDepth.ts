export type SearchDepth = 'quick' | 'standard' | 'deep' | 'orientation'

export type SearchMode = 'general' | 'company' | 'application'

export type SearchModeOption = {
  id: SearchMode
  label: string
  /** Why you’d pick this mode */
  purpose: string
  detail: string
}

export const SEARCH_MODES: SearchModeOption[] = [
  {
    id: 'general',
    label: 'General',
    purpose: 'Discover companies + people in your niches',
    detail:
      'We rank companies in your target industries, then find people in similar roles at each.',
  },
  {
    id: 'company',
    label: 'Specific',
    purpose: 'Target one company you name',
    detail:
      'We keep searching that employer until we hit your target count (or 3 empty rounds).',
  },
  {
    id: 'application',
    label: 'Application',
    purpose: 'Follow up on a job you applied to',
    detail:
      'Paste the posting — we extract the role and find team peers for a referral ask.',
  },
]

export type CompanyPeopleTarget = 1 | 2 | 5

export const COMPANY_PEOPLE_TARGETS: CompanyPeopleTarget[] = [1, 2, 5]

export function isCompanyPeopleTarget(n: number): n is CompanyPeopleTarget {
  return n === 1 || n === 2 || n === 5
}

/** Industry discovery queries per run (see run-search / companyWebSearchQueryBudget). */
const PLAN_WEB_SEARCHES = 8
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
    id: 'orientation',
    label: 'Calibration',
    companies: 4,
    perCompany: 1,
    webSearchCredits: webCredits(4),
    hunterDomainCalls: 4,
    hunterMaxFindVerify: 4,
    eta: '~1–3 min',
    estimatePeople: 'exactly ~4 contacts',
    blurb: 'Orientation calibration: four people to keep or discard.',
  },
  {
    id: 'quick',
    label: 'Low',
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
    label: 'Medium',
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
    label: 'High',
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
  return SEARCH_DEPTHS.find((d) => d.id === id) || SEARCH_DEPTHS[2]
}

/** Max contacts for general search size (companies × people per company). */
export function depthPeopleCap(preset: DepthPreset): number {
  return preset.companies * preset.perCompany
}

export function depthSizeSummary(preset: DepthPreset): string {
  return `${preset.companies} companies · ${depthPeopleCap(preset)} people`
}

/** Depths shown in the normal (post-orientation) picker. */
export const USER_SEARCH_DEPTHS: DepthPreset[] = SEARCH_DEPTHS.filter(
  (d) => d.id !== 'orientation',
)

const ACTIVE_RUN_KEY = 'followup_active_search_run'
const ACTIVE_DEPTH_KEY = 'followup_active_search_depth'
const ACTIVE_MODE_KEY = 'followup_active_search_mode'
const ACTIVE_TARGET_KEY = 'followup_active_search_target'
const ACTIVE_COMPANY_PEOPLE_KEY = 'followup_active_company_people'
const ACTIVE_JOB_POSTING_KEY = 'followup_active_job_posting'
const ACTIVE_APPLICATION_KEY = 'followup_active_application'

export type ApplicationExtract = {
  company: string
  job_title: string
  job_description: string
  /** Optional job location from the posting */
  location: string
  projects: string[]
  responsibilities: string[]
  search_titles?: string[]
  search_keywords?: string[]
}

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
    if (d === 'quick' || d === 'standard' || d === 'deep' || d === 'orientation')
      return d
  } catch {
    // ignore
  }
  return 'standard'
}

export function saveActiveRunMode(mode: SearchMode) {
  try {
    sessionStorage.setItem(ACTIVE_MODE_KEY, mode)
  } catch {
    // ignore
  }
}

export function loadActiveRunMode(): SearchMode {
  try {
    const m = sessionStorage.getItem(ACTIVE_MODE_KEY) as SearchMode | null
    if (m === 'general' || m === 'company' || m === 'application') return m
  } catch {
    // ignore
  }
  return 'general'
}

export function saveActiveRunTargetCompany(name: string | null) {
  try {
    if (name?.trim()) sessionStorage.setItem(ACTIVE_TARGET_KEY, name.trim())
    else sessionStorage.removeItem(ACTIVE_TARGET_KEY)
  } catch {
    // ignore
  }
}

export function loadActiveRunTargetCompany(): string {
  try {
    return sessionStorage.getItem(ACTIVE_TARGET_KEY) || ''
  } catch {
    return ''
  }
}

export function saveActiveJobPosting(text: string | null) {
  try {
    if (text?.trim()) sessionStorage.setItem(ACTIVE_JOB_POSTING_KEY, text)
    else sessionStorage.removeItem(ACTIVE_JOB_POSTING_KEY)
  } catch {
    // ignore
  }
}

export function loadActiveJobPosting(): string {
  try {
    return sessionStorage.getItem(ACTIVE_JOB_POSTING_KEY) || ''
  } catch {
    return ''
  }
}

export function saveActiveApplicationExtract(data: ApplicationExtract | null) {
  try {
    if (data) sessionStorage.setItem(ACTIVE_APPLICATION_KEY, JSON.stringify(data))
    else sessionStorage.removeItem(ACTIVE_APPLICATION_KEY)
  } catch {
    // ignore
  }
}

export function loadActiveApplicationExtract(): ApplicationExtract | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_APPLICATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ApplicationExtract
    if (!parsed || typeof parsed !== 'object') return null
    return {
      company: String(parsed.company || ''),
      job_title: String(parsed.job_title || ''),
      job_description: String(parsed.job_description || ''),
      location: String(parsed.location || ''),
      projects: Array.isArray(parsed.projects)
        ? parsed.projects.map(String)
        : [],
      responsibilities: Array.isArray(parsed.responsibilities)
        ? parsed.responsibilities.map(String)
        : [],
      search_titles: Array.isArray(parsed.search_titles)
        ? parsed.search_titles.map(String)
        : undefined,
      search_keywords: Array.isArray(parsed.search_keywords)
        ? parsed.search_keywords.map(String)
        : undefined,
    }
  } catch {
    return null
  }
}

export function saveActiveCompanyPeopleTarget(n: CompanyPeopleTarget) {
  try {
    sessionStorage.setItem(ACTIVE_COMPANY_PEOPLE_KEY, String(n))
  } catch {
    // ignore
  }
}

export function loadActiveCompanyPeopleTarget(): CompanyPeopleTarget {
  try {
    const v = Number(sessionStorage.getItem(ACTIVE_COMPANY_PEOPLE_KEY))
    if (v === 1 || v === 2 || v === 5) return v
  } catch {
    // ignore
  }
  return 2
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

/** Prefill Search for a specific-company follow-up (user still presses Run). */
export function prefillSpecificCompanySearch(companyName: string) {
  saveActiveRunMode('company')
  saveActiveRunTargetCompany(companyName.trim())
}
