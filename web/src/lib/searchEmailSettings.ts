import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_FILTERS, type SearchFiltersData } from '../types/database'

export type SearchEmailSettings = {
  enable_hunter: boolean
  require_verified_email: boolean
  accept_accept_all: boolean
}

export const DEFAULT_SEARCH_EMAIL_SETTINGS: SearchEmailSettings = {
  enable_hunter: false,
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
    require_verified_email: raw.require_verified_email === true,
    accept_accept_all: raw.accept_accept_all !== false,
  }
}

export async function loadSearchEmailSettings(
  client: SupabaseClient,
  userId: string,
): Promise<SearchEmailSettings> {
  const { data } = await client
    .from('search_filters')
    .select('filters')
    .eq('user_id', userId)
    .maybeSingle()
  return emailSettingsFromFilters(
    data?.filters as Record<string, unknown> | undefined,
  )
}

export async function saveSearchEmailSettings(
  client: SupabaseClient,
  userId: string,
  settings: SearchEmailSettings,
): Promise<{ error: string | null }> {
  const { data: existing } = await client
    .from('search_filters')
    .select('filters')
    .eq('user_id', userId)
    .maybeSingle()

  const prev = (existing?.filters || {}) as SearchFiltersData
  const filters: SearchFiltersData = {
    ...DEFAULT_FILTERS,
    ...prev,
    enable_hunter: settings.enable_hunter,
    require_verified_email: settings.require_verified_email,
    accept_accept_all: settings.accept_accept_all,
  }

  const { error } = await client.from('search_filters').upsert(
    {
      user_id: userId,
      filters,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  return { error: error?.message ?? null }
}
