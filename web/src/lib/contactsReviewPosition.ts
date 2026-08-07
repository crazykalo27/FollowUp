/** Persist which pending contact the user was reviewing across navigation. */

export type ContactsReviewPosition = {
  activeId: string | null
  /** Newest contact created_at (ISO) last seen on Contacts — newer means jump to new picks. */
  newestCreatedAt: string | null
}

function storageKey(userId: string) {
  return `followup:contacts-review:${userId}`
}

export function loadContactsReviewPosition(
  userId: string,
): ContactsReviewPosition | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ContactsReviewPosition
    return {
      activeId: parsed.activeId || null,
      newestCreatedAt: parsed.newestCreatedAt || null,
    }
  } catch {
    return null
  }
}

export function saveContactsReviewPosition(
  userId: string,
  position: ContactsReviewPosition,
) {
  try {
    sessionStorage.setItem(storageKey(userId), JSON.stringify(position))
  } catch {
    // ignore quota / private mode
  }
}

/** True if `a` is strictly newer than `b` (ISO timestamps). */
export function isNewerIso(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return false
  if (!b) return true
  return new Date(a).getTime() > new Date(b).getTime()
}
