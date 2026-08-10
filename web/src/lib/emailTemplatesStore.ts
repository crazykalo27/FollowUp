import {
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
} from './emailTemplate'

export type SavedEmailTemplate = {
  id: string
  name: string
  subject: string
  body: string
}

export type EmailTemplatesState = {
  active_id: string
  items: SavedEmailTemplate[]
}

export function newTemplateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function defaultEmailTemplatesState(): EmailTemplatesState {
  const id = newTemplateId()
  return {
    active_id: id,
    items: [
      {
        id,
        name: 'Default',
        subject: DEFAULT_EMAIL_SUBJECT_TEMPLATE,
        body: DEFAULT_EMAIL_BODY_TEMPLATE,
      },
    ],
  }
}

export function normalizeEmailTemplates(
  raw: unknown,
  fallbackSubject?: string | null,
  fallbackBody?: string | null,
): EmailTemplatesState {
  const subject =
    fallbackSubject?.trim() || DEFAULT_EMAIL_SUBJECT_TEMPLATE
  const body = fallbackBody?.trim() || DEFAULT_EMAIL_BODY_TEMPLATE

  if (raw && typeof raw === 'object') {
    const obj = raw as { active_id?: string; items?: unknown }
    const items = Array.isArray(obj.items)
      ? obj.items
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const t = item as Record<string, unknown>
            const id = String(t.id || newTemplateId())
            const name = String(t.name || 'Untitled').trim() || 'Untitled'
            return {
              id,
              name,
              subject: String(t.subject || subject),
              body: String(t.body || body),
            } satisfies SavedEmailTemplate
          })
          .filter(Boolean) as SavedEmailTemplate[]
      : []
    if (items.length > 0) {
      const active =
        items.find((i) => i.id === obj.active_id)?.id || items[0].id
      return { active_id: active, items }
    }
  }

  const id = newTemplateId()
  return {
    active_id: id,
    items: [{ id, name: 'Default', subject, body }],
  }
}

export function activeTemplate(
  state: EmailTemplatesState,
): SavedEmailTemplate {
  return (
    state.items.find((i) => i.id === state.active_id) || state.items[0]
  )
}
