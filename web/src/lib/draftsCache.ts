import { supabase } from './supabase'
import type { DraftStatus } from '../types/database'
import {
  activeTemplate,
  defaultEmailTemplatesState,
  normalizeEmailTemplates,
  type EmailTemplatesState,
} from './emailTemplatesStore'

export type DraftRow = {
  id: string
  contact_id: string
  subject: string
  body: string
  status: DraftStatus
  sent_at: string | null
  error_message: string | null
  bounce_summary: string | null
  contacts: {
    full_name: string | null
    email: string | null
    companies: { name: string } | { name: string }[] | null
  } | null
}

export type DraftsCacheSnapshot = {
  userId: string | null
  drafts: DraftRow[]
  templatesState: EmailTemplatesState
  subjectTemplate: string
  bodyTemplate: string
  resumeFileName: string | null
  /** True once at least one successful fetch finished for this user. */
  ready: boolean
}

type Listener = () => void

const emptyTemplates = defaultEmailTemplatesState()
const emptyActive = activeTemplate(emptyTemplates)

let snapshot: DraftsCacheSnapshot = {
  userId: null,
  drafts: [],
  templatesState: emptyTemplates,
  subjectTemplate: emptyActive.subject,
  bodyTemplate: emptyActive.body,
  resumeFileName: null,
  ready: false,
}

const listeners = new Set<Listener>()
let inflight: Promise<DraftsCacheSnapshot> | null = null
let inflightUserId: string | null = null

function emit() {
  for (const listener of listeners) listener()
}

export function getDraftsCache(): DraftsCacheSnapshot {
  return snapshot
}

export function subscribeDraftsCache(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setCachedDrafts(drafts: DraftRow[]) {
  if (!snapshot.userId) return
  snapshot = { ...snapshot, drafts, ready: true }
  emit()
}

export function setCachedTemplates(
  templatesState: EmailTemplatesState,
  resumeFileName?: string | null,
) {
  if (!snapshot.userId) return
  const active = activeTemplate(templatesState)
  snapshot = {
    ...snapshot,
    templatesState,
    subjectTemplate: active.subject,
    bodyTemplate: active.body,
    resumeFileName:
      resumeFileName === undefined ? snapshot.resumeFileName : resumeFileName,
  }
  emit()
}

function mapDraftRows(data: unknown[] | null): DraftRow[] {
  return (data || []).map((raw) => {
    const d = raw as DraftRow & { contacts: DraftRow['contacts'] | DraftRow['contacts'][] }
    return {
      ...d,
      contacts: Array.isArray(d.contacts) ? d.contacts[0] : d.contacts,
    }
  })
}

/** Fetch drafts (+ templates) into the shared cache. Dedupes concurrent calls. */
export async function prefetchDrafts(
  userId: string,
): Promise<DraftsCacheSnapshot> {
  if (inflight && inflightUserId === userId) return inflight

  if (snapshot.userId !== userId) {
    snapshot = {
      userId,
      drafts: [],
      templatesState: emptyTemplates,
      subjectTemplate: emptyActive.subject,
      bodyTemplate: emptyActive.body,
      resumeFileName: null,
      ready: false,
    }
    emit()
  }

  inflightUserId = userId
  inflight = (async () => {
    const [{ data: draftData }, { data: prof }, { data: resume }] =
      await Promise.all([
        supabase
          .from('outreach_drafts')
          .select(
            'id, contact_id, subject, body, status, sent_at, error_message, bounce_summary, contacts(full_name, email, companies(name))',
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select(
            'email_subject_template, email_body_template, email_templates',
          )
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('resumes')
          .select('file_name')
          .eq('user_id', userId)
          .order('uploaded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

    const drafts = mapDraftRows(draftData as unknown[] | null)
    const templatesState = normalizeEmailTemplates(
      prof?.email_templates,
      prof?.email_subject_template,
      prof?.email_body_template,
    )
    const active = activeTemplate(templatesState)

    snapshot = {
      userId,
      drafts,
      templatesState,
      subjectTemplate: active.subject,
      bodyTemplate: active.body,
      resumeFileName: resume?.file_name || null,
      ready: true,
    }
    emit()
    return snapshot
  })().finally(() => {
    inflight = null
    inflightUserId = null
  })

  return inflight
}

/** Refresh only the outbox list (keeps in-progress template edits intact). */
export async function refreshDraftsList(userId: string): Promise<DraftRow[]> {
  const { data: draftData } = await supabase
    .from('outreach_drafts')
    .select(
      'id, contact_id, subject, body, status, sent_at, error_message, bounce_summary, contacts(full_name, email, companies(name))',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  const drafts = mapDraftRows(draftData as unknown[] | null)
  if (snapshot.userId === userId) {
    snapshot = { ...snapshot, drafts, ready: true }
    emit()
  } else {
    snapshot = {
      userId,
      drafts,
      templatesState: emptyTemplates,
      subjectTemplate: emptyActive.subject,
      bodyTemplate: emptyActive.body,
      resumeFileName: null,
      ready: true,
    }
    emit()
  }
  return drafts
}
