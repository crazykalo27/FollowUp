export type SearchDepth = 'quick' | 'standard' | 'deep'

export type DepthPreset = {
  id: SearchDepth
  label: string
  companies: number
  perCompany: number
  eta: string
  estimatePeople: string
  blurb: string
}

export const SEARCH_DEPTHS: DepthPreset[] = [
  {
    id: 'quick',
    label: 'Quick',
    companies: 3,
    perCompany: 2,
    eta: '~30–90 sec',
    estimatePeople: 'up to ~6 contacts',
    blurb: 'Few companies, fast check that the pipeline works.',
  },
  {
    id: 'standard',
    label: 'Standard',
    companies: 6,
    perCompany: 3,
    eta: '~2–5 min',
    estimatePeople: 'up to ~18 contacts',
    blurb: 'Balanced depth for a normal outreach batch.',
  },
  {
    id: 'deep',
    label: 'Deep',
    companies: 8,
    perCompany: 4,
    eta: '~3–4 min',
    estimatePeople: 'up to ~32 contacts',
    blurb: 'More companies; may stop early near the server time limit.',
  },
]

export function depthPreset(id: SearchDepth): DepthPreset {
  return SEARCH_DEPTHS.find((d) => d.id === id) || SEARCH_DEPTHS[1]
}

const ACTIVE_RUN_KEY = 'followup_active_search_run'

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
