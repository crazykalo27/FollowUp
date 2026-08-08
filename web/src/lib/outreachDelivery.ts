export const OUTREACH_PENDING_CONFIRM_MS = 5 * 60 * 1000

export function pendingElapsedMs(sentAt: string | null, now = Date.now()): number {
  if (!sentAt) return 0
  return Math.max(0, now - new Date(sentAt).getTime())
}

export function formatPendingTimer(sentAt: string | null, now = Date.now()): string {
  const elapsed = pendingElapsedMs(sentAt, now)
  const remaining = Math.max(0, OUTREACH_PENDING_CONFIRM_MS - elapsed)
  const sec = Math.floor(remaining / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (remaining > 0) {
    return `Pending · ${m}:${String(s).padStart(2, '0')} until confirmed`
  }
  const eSec = Math.floor(elapsed / 1000)
  const em = Math.floor(eSec / 60)
  const es = eSec % 60
  return `Pending · ${em}:${String(es).padStart(2, '0')} (checking…)`
}
