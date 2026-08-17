import { supabase } from './supabase'
import { invokeFunction } from './api'
import type { SearchProfileData } from '../types/database'

export type SearchProfileListItem = {
  id: string
  name: string
  resume_id: string | null
  is_active: boolean
  profile: SearchProfileData | null
  chat_summary: string | null
  updated_at: string
  resumes: { file_name: string; uploaded_at: string } | { file_name: string; uploaded_at: string }[] | null
}

export function resumeFileName(row: SearchProfileListItem): string | null {
  const r = row.resumes
  if (!r) return null
  if (Array.isArray(r)) return r[0]?.file_name || null
  return r.file_name || null
}

export function profileNicheLine(profile: SearchProfileData | null | undefined): string {
  if (!profile) return 'No targets yet'
  const bits = [
    ...(profile.roles || []).slice(0, 2),
    ...(profile.industries || []).slice(0, 2),
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : 'No targets yet'
}

export async function loadActiveSearchProfile(userId: string) {
  const { data, error } = await supabase
    .from('search_profiles')
    .select(
      'id, name, resume_id, is_active, profile, chat_summary, updated_at, resumes(file_name, uploaded_at)',
    )
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as SearchProfileListItem | null
}

export async function listSearchProfiles() {
  const res = await invokeFunction<{ ok: true; profiles: SearchProfileListItem[] }>(
    'manage-search-profiles',
    { action: 'list' },
  )
  return res.profiles || []
}

export async function activateSearchProfile(id: string) {
  await invokeFunction('manage-search-profiles', { action: 'activate', id })
}

export async function renameSearchProfile(id: string, name: string) {
  await invokeFunction('manage-search-profiles', { action: 'rename', id, name })
}

export async function deleteSearchProfile(id: string) {
  await invokeFunction('manage-search-profiles', { action: 'delete', id })
}

export async function createSearchProfile(resumeId: string, name?: string) {
  return invokeFunction<{ ok: true; profile: { id: string; name: string } }>(
    'manage-search-profiles',
    { action: 'create', resume_id: resumeId, name },
  )
}

export async function attachResumeToProfile(id: string, resumeId: string) {
  await invokeFunction('manage-search-profiles', {
    action: 'attach_resume',
    id,
    resume_id: resumeId,
  })
}
