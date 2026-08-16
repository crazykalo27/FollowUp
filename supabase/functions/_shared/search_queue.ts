import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type CompanyHitQueued = {
  company_name: string
  domain: string | null
  url: string
  source: string
  hiring_signal?: string | null
  relevance?: number
}

export type HunterRunStateQueued = {
  quotaExhausted: boolean
  quotaNote: string | null
}

export type SourceStatsQueued = {
  configured: boolean
  attempted: number
  people_found: number
  after_title_filter: number
  with_email: number
  contacts_kept: number
  errors: string[]
  note?: string | null
}

export type SearchPipelineState = {
  version: 1
  depth: string
  selected: CompanyHitQueued[]
  company_index: number
  contactsCreated: number
  contactsSkippedDuplicate: number
  companiesSelected: number
  company_reports: Array<Record<string, unknown>>
  errors: string[]
  source_stats: Record<string, SourceStatsQueued>
  hunterState: HunterRunStateQueued
  tombaState?: HunterRunStateQueued
  /** Specific-company search: reuse employer row across retry rounds */
  company_ctx?: {
    domain: string
    companyId: string
    canonicalName: string
    companyKey: string
  } | null
  company_find_failures?: number
  company_attempt?: number
  company_kept_total?: number
  tried_candidate_keys?: string[]
  /** Temporary people-search loosen aspects already used this company (not persisted niches). */
  company_loosen_aspects?: string[]
  plan_meta: {
    webCompanies: number
    allJobs: number
    remotiveCount: number
    adzunaCount: number
    jobQueries: string[]
    companyQueries: string[]
    company_discovery_stats: {
      attempted: number
      found: number
      errors: string[]
      rounds?: number
      queries?: string[]
    }
    peopleTitles: string[]
    deptKeywords: string[]
    targetRoles: string[]
    industries: string[]
    companyTypes: string[]
    outreachTargets: string[]
    skills: string[]
    location: string
    webConfigured: boolean
    hunterEnabled: boolean
    apolloEnabled: boolean
    tombaEnabled?: boolean
    include: string[]
    exclude: string[]
    maxCompanies: number
    maxPerCompany: number
    require_verified_email: boolean
    accept_accept_all: boolean
    search_mode?: 'general' | 'company' | 'application'
    target_company?: string | null
    company_people_target?: number
    /** Application-mode job context attached to contacts */
    application?: {
      job_title: string
      job_description: string
      location?: string
      projects: string[]
      responsibilities: string[]
      raw_excerpt: string
      light_keywords?: string[]
    } | null
  }
}

export async function loadPipelineState(
  admin: SupabaseClient,
  runId: string,
): Promise<SearchPipelineState | null> {
  const { data } = await admin
    .from('search_runs')
    .select('pipeline_state')
    .eq('id', runId)
    .maybeSingle()
  const raw = data?.pipeline_state
  if (!raw || typeof raw !== 'object') return null
  const p = raw as SearchPipelineState
  if (p.version !== 1 || !Array.isArray(p.selected)) return null
  return p
}

export async function savePipelineState(
  admin: SupabaseClient,
  runId: string,
  state: SearchPipelineState,
): Promise<void> {
  await admin
    .from('search_runs')
    .update({
      pipeline_state: state,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

async function postChain(
  runId: string,
  depth: string,
): Promise<Response> {
  const base = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!base || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
  }
  const url = `${base.replace(/\/$/, '')}/functions/v1/run-search`
  return await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ run_id: runId, depth, chain: true }),
    },
    55_000,
  )
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

/** Fire-and-forget next chunk (service role → same function). */
export function scheduleSearchContinue(
  admin: SupabaseClient,
  runId: string,
  depth: string,
): void {
  const run = async () => {
    try {
      let res = await postChain(runId, depth)
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 2500))
        res = await postChain(runId, depth)
      }
      if (!res.ok) {
        await admin
          .from('search_runs')
          .update({
            message: 'Search paused — will auto-resume',
            detail: `Background step HTTP ${res.status}; waiting for nudge`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', runId)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'chain failed'
      await admin
        .from('search_runs')
        .update({
          message: 'Search paused — will auto-resume',
          detail: msg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
    }
  }

  const er = (
    globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }
  ).EdgeRuntime
  if (er?.waitUntil) er.waitUntil(run())
  else void run()
}

export function isServiceChainRequest(req: Request): boolean {
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!key) return false
  const auth = req.headers.get('Authorization') || ''
  return auth === `Bearer ${key}`
}
