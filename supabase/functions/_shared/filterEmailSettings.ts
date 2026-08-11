/** Read email discovery toggles from search_filters JSON (server-side). */

export type ServerEmailSettings = {
  enable_hunter: boolean
  enable_apollo: boolean
  enable_smtp_verify: boolean
  require_verified_email: boolean
  accept_accept_all: boolean
}

const DEFAULTS: ServerEmailSettings = {
  enable_hunter: false,
  enable_apollo: false,
  enable_smtp_verify: false,
  require_verified_email: false,
  accept_accept_all: true,
}

export function emailSettingsFromFilters(
  raw: Record<string, unknown> | null | undefined,
): ServerEmailSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  return {
    enable_hunter: raw.enable_hunter === true,
    enable_apollo: raw.enable_apollo === true,
    enable_smtp_verify: raw.enable_smtp_verify === true,
    require_verified_email: raw.require_verified_email === true,
    accept_accept_all: raw.accept_accept_all !== false,
  }
}
