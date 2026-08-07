import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export type CompanyProgressStatus = 'pending' | 'active' | 'done' | 'skipped'

export type CompanyProgressRow = {
  name: string
  status: CompanyProgressStatus
  step: string
  step_progress: number
}

export type ProgressLogEntry = {
  ts: string
  text: string
}

export type ProgressMeta = {
  companies: CompanyProgressRow[]
  log: ProgressLogEntry[]
}

const MAX_LOG = 18

export function emptyProgressMeta(): ProgressMeta {
  return { companies: [], log: [] }
}

export function initCompaniesProgress(
  names: string[],
): CompanyProgressRow[] {
  return names.map((name) => ({
    name,
    status: 'pending',
    step: 'Queued',
    step_progress: 0,
  }))
}

export function pushProgressLog(meta: ProgressMeta, text: string): void {
  meta.log.unshift({ ts: new Date().toISOString(), text })
  if (meta.log.length > MAX_LOG) meta.log.length = MAX_LOG
}

export function setCompanyProgress(
  meta: ProgressMeta,
  companyName: string,
  patch: Partial<CompanyProgressRow>,
): void {
  const row = meta.companies.find((c) => c.name === companyName)
  if (!row) return
  Object.assign(row, patch)
}

export function markCompanyDone(
  meta: ProgressMeta,
  companyName: string,
  outcome: string,
): void {
  setCompanyProgress(meta, companyName, {
    status: 'done',
    step: outcome,
    step_progress: 100,
  })
}

export function markCompanySkipped(
  meta: ProgressMeta,
  companyName: string,
  reason: string,
): void {
  setCompanyProgress(meta, companyName, {
    status: 'skipped',
    step: reason,
    step_progress: 100,
  })
}

/** Overall run %: plan ~0–25, companies ~25–99 */
export function computeRunProgress(
  meta: ProgressMeta,
  companiesDone: number,
  planProgress: number,
): number {
  const total = meta.companies.length
  if (total === 0) return Math.min(99, Math.max(0, planProgress))
  const active = meta.companies.find((c) => c.status === 'active')
  const activeFrac = active ? active.step_progress / 100 : 0
  const companyPart = (companiesDone + activeFrac) / total
  return Math.min(99, Math.round(25 + 75 * companyPart))
}

export async function loadProgressMeta(
  admin: SupabaseClient,
  runId: string,
): Promise<ProgressMeta> {
  const { data } = await admin
    .from('search_runs')
    .select('progress_meta')
    .eq('id', runId)
    .maybeSingle()
  const raw = data?.progress_meta
  if (!raw || typeof raw !== 'object') return emptyProgressMeta()
  const m = raw as ProgressMeta
  return {
    companies: Array.isArray(m.companies) ? m.companies : [],
    log: Array.isArray(m.log) ? m.log : [],
  }
}

export async function saveProgressMeta(
  admin: SupabaseClient,
  runId: string,
  meta: ProgressMeta,
): Promise<void> {
  await admin
    .from('search_runs')
    .update({
      progress_meta: meta,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
}
