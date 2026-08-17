import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_FILTERS, type SearchFiltersData } from '../types/database'

export type SearchEmailSettings = {
  enable_hunter: boolean
  enable_apollo: boolean
  enable_tomba: boolean
  enable_smtp_verify: boolean
  require_verified_email: boolean
  accept_accept_all: boolean
}

export const DEFAULT_SEARCH_EMAIL_SETTINGS: SearchEmailSettings = {
  enable_hunter: false,
  enable_apollo: false,
  enable_tomba: false,
  enable_smtp_verify: false,
  require_verified_email: false,
  accept_accept_all: true,
}

/** Read booleans from stored JSON — missing hunter/verified keys default OFF. */
export function emailSettingsFromFilters(
  raw: Record<string, unknown> | null | undefined,
): SearchEmailSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SEARCH_EMAIL_SETTINGS }
  }
  return {
    enable_hunter: raw.enable_hunter === true,
    enable_apollo: raw.enable_apollo === true,
    enable_tomba: raw.enable_tomba === true,
    enable_smtp_verify: raw.enable_smtp_verify === true,
    require_verified_email: raw.require_verified_email === true,
    accept_accept_all: raw.accept_accept_all !== false,
  }
}

/** Drop removed run-size keys still present in older search_filters JSON. */
export function withoutLegacyRunLimits(
  filters: Record<string, unknown>,
): SearchFiltersData {
  const next = { ...DEFAULT_FILTERS, ...filters } as SearchFiltersData &
    Record<string, unknown>
  delete next.max_companies_per_run
  delete next.max_contacts_per_company
  return next
}

export async function loadSearchEmailSettings(
  client: SupabaseClient,
  userId: string,
): Promise<SearchEmailSettings> {
  const { data: active } = await client
    .from('search_profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  let q = client.from('search_filters').select('filters').eq('user_id', userId)
  if (active?.id) q = q.eq('search_profile_id', active.id)
  const { data } = await q.maybeSingle()
  return emailSettingsFromFilters(
    data?.filters as Record<string, unknown> | undefined,
  )
}

export async function saveSearchEmailSettings(
  client: SupabaseClient,
  userId: string,
  settings: SearchEmailSettings,
): Promise<{ error: string | null }> {
  const { data: rows } = await client
    .from('search_filters')
    .select('id, filters')
    .eq('user_id', userId)

  const patch = {
    enable_hunter: settings.enable_hunter,
    enable_apollo: settings.enable_apollo,
    enable_tomba: settings.enable_tomba,
    enable_smtp_verify: settings.enable_smtp_verify,
    require_verified_email: settings.require_verified_email,
    accept_accept_all: settings.accept_accept_all,
  }

  if (!rows?.length) {
    const { error } = await client.from('search_filters').insert({
      user_id: userId,
      filters: withoutLegacyRunLimits({ ...DEFAULT_FILTERS, ...patch }),
    })
    return { error: error?.message ?? null }
  }

  for (const row of rows) {
    const prev = (row.filters || {}) as Record<string, unknown>
    const filters = withoutLegacyRunLimits({
      ...DEFAULT_FILTERS,
      ...prev,
      ...patch,
    })
    const { error } = await client
      .from('search_filters')
      .update({ filters, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (error) return { error: error.message }
  }
  return { error: null }
}
