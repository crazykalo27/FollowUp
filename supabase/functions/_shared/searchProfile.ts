import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { DEFAULT_SEARCH_FILTERS } from './defaultFilters.ts'

export type SearchProfileRow = {
  id: string
  user_id: string
  name: string
  resume_id: string | null
  is_active: boolean
  profile: Record<string, unknown>
  chat_summary: string | null
}

export async function loadActiveSearchProfile(
  admin: SupabaseClient,
  userId: string,
): Promise<SearchProfileRow | null> {
  const { data } = await admin
    .from('search_profiles')
    .select('id, user_id, name, resume_id, is_active, profile, chat_summary')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as SearchProfileRow | null) ?? null
}

export async function loadSearchProfileById(
  admin: SupabaseClient,
  userId: string,
  profileId: string,
): Promise<SearchProfileRow | null> {
  const { data } = await admin
    .from('search_profiles')
    .select('id, user_id, name, resume_id, is_active, profile, chat_summary')
    .eq('user_id', userId)
    .eq('id', profileId)
    .maybeSingle()
  return (data as SearchProfileRow | null) ?? null
}

export async function ensureActiveSearchProfile(
  admin: SupabaseClient,
  userId: string,
): Promise<SearchProfileRow> {
  const existing = await loadActiveSearchProfile(admin, userId)
  if (existing) return existing

  const { data: anyRow } = await admin
    .from('search_profiles')
    .select('id, user_id, name, resume_id, is_active, profile, chat_summary')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (anyRow) {
    await admin
      .from('search_profiles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
    await admin
      .from('search_profiles')
      .update({ is_active: true, updated_at: new Date().toISOString() })
      .eq('id', anyRow.id)
    return { ...(anyRow as SearchProfileRow), is_active: true }
  }

  const { data: created, error } = await admin
    .from('search_profiles')
    .insert({
      user_id: userId,
      name: 'Search profile',
      is_active: true,
      profile: {},
    })
    .select('id, user_id, name, resume_id, is_active, profile, chat_summary')
    .single()
  if (error || !created) {
    throw new Error(error?.message || 'Could not create search profile')
  }

  await admin.from('search_filters').insert({
    user_id: userId,
    search_profile_id: created.id,
    filters: DEFAULT_SEARCH_FILTERS,
  })
  await admin.from('preference_documents').insert({
    user_id: userId,
    search_profile_id: created.id,
  })
  return created as SearchProfileRow
}

export async function loadResumeForProfile(
  admin: SupabaseClient,
  userId: string,
  resumeId: string | null | undefined,
) {
  if (resumeId) {
    const { data } = await admin
      .from('resumes')
      .select('id, extracted_text, file_name, uploaded_at, storage_path')
      .eq('user_id', userId)
      .eq('id', resumeId)
      .maybeSingle()
    if (data) return data
  }
  const { data } = await admin
    .from('resumes')
    .select('id, extracted_text, file_name, uploaded_at, storage_path')
    .eq('user_id', userId)
    .order('uploaded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function copyEmailToggles(
  fromFilters: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown>> {
  const src = fromFilters || {}
  return {
    ...DEFAULT_SEARCH_FILTERS,
    enable_hunter: src.enable_hunter === true,
    enable_apollo: src.enable_apollo === true,
    enable_tomba: src.enable_tomba === true,
    enable_smtp_verify: src.enable_smtp_verify === true,
    require_verified_email: src.require_verified_email === true,
    accept_accept_all: src.accept_accept_all !== false,
  }
}
