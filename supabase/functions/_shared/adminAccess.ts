import type { User } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

/** Comma-separated login emails in Edge secret ADMIN_EMAILS. */
export function adminEmailsFromEnv(): string[] {
  const raw = Deno.env.get('ADMIN_EMAILS') || ''
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'))
}

export function isAdminUser(user: User): boolean {
  const email = (user.email || '').trim().toLowerCase()
  if (email && adminEmailsFromEnv().includes(email)) return true
  const meta = (user.app_metadata || {}) as Record<string, unknown>
  if (meta.admin === true || meta.role === 'admin') return true
  return false
}
