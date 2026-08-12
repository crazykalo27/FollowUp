export type ContactSort = 'recent_added' | 'recent_kept' | 'alpha'

export type ContactListFields = {
  id: string
  full_name?: string | null
  title?: string | null
  email?: string | null
  location?: string | null
  filter_match_reason?: string | null
  created_at?: string | null
  /** ISO time of latest keep decision (or restore), when known */
  kept_at?: string | null
  companies?: { name?: string | null; domain?: string | null } | null
}

/** Extra free-text fields (e.g. resolved display location) to include in search. */
export function contactMatchesQuery(
  contact: ContactListFields,
  query: string,
  extraText: string[] = [],
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    contact.full_name,
    contact.title,
    contact.email,
    contact.location,
    contact.filter_match_reason,
    contact.companies?.name,
    contact.companies?.domain,
    ...extraText,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}

function timeMs(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

export function sortContacts<T extends ContactListFields>(
  rows: T[],
  sort: ContactSort,
): T[] {
  const list = [...rows]
  if (sort === 'alpha') {
    list.sort((a, b) => {
      const an = (a.full_name || a.email || a.title || '').trim()
      const bn = (b.full_name || b.email || b.title || '').trim()
      const byName = an.localeCompare(bn, undefined, { sensitivity: 'base' })
      if (byName !== 0) return byName
      return a.id.localeCompare(b.id)
    })
    return list
  }
  if (sort === 'recent_kept') {
    list.sort((a, b) => {
      const ka = timeMs(a.kept_at)
      const kb = timeMs(b.kept_at)
      if (kb !== ka) return kb - ka
      // No keep time → fall back to recently added
      return timeMs(b.created_at) - timeMs(a.created_at) || a.id.localeCompare(b.id)
    })
    return list
  }
  // recent_added (default)
  list.sort((a, b) => {
    return timeMs(b.created_at) - timeMs(a.created_at) || a.id.localeCompare(b.id)
  })
  return list
}

export function filterAndSortContacts<T extends ContactListFields>(
  rows: T[],
  query: string,
  sort: ContactSort,
  extraTextFor?: (row: T) => string[],
): T[] {
  const filtered = rows.filter((r) =>
    contactMatchesQuery(r, query, extraTextFor?.(r) || []),
  )
  return sortContacts(filtered, sort)
}
