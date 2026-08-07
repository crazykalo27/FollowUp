import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import type { DraftStatus } from '../types/database'
import {
  applyTemplate,
  DEFAULT_EMAIL_BODY_TEMPLATE,
  DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  SAMPLE_PREVIEW_VARS,
  TEMPLATE_PLACEHOLDER_HELP,
} from '../lib/emailTemplate'
import { EMAIL_TEMPLATE_PRESETS } from '../lib/emailTemplatePresets'

type DraftRow = {
  id: string
  contact_id: string
  subject: string
  body: string
  status: DraftStatus
  sent_at: string | null
  error_message: string | null
  contacts: { full_name: string | null; email: string | null } | null
}

function formatSentDate(sentAt: string | null) {
  if (!sentAt) return 'Sent'
  try {
    return `Sent ${new Date(sentAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`
  } catch {
    return 'Sent'
  }
}

export function DraftsPage() {
  const { user } = useAuth()
  const orientation = useOrientation()
  const [searchParams, setSearchParams] = useSearchParams()
  const orientContactId = searchParams.get('contact')
  const inOrientation = !orientation.complete
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [active, setActive] = useState<DraftRow | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [resumeFileName, setResumeFileName] = useState<string | null>(null)
  const [contactName, setContactName] = useState<string | null>(null)
  const [subjectTemplate, setSubjectTemplate] = useState(
    DEFAULT_EMAIL_SUBJECT_TEMPLATE,
  )
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_EMAIL_BODY_TEMPLATE)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const orientDraftStarted = useRef(false)

  const templatePreview = useMemo(() => {
    return {
      subject: applyTemplate(subjectTemplate, SAMPLE_PREVIEW_VARS),
      body: applyTemplate(bodyTemplate, SAMPLE_PREVIEW_VARS),
    }
  }, [subjectTemplate, bodyTemplate])

  const sentContactIds = useMemo(
    () =>
      new Set(
        drafts.filter((d) => d.status === 'sent').map((d) => d.contact_id),
      ),
    [drafts],
  )

  const outreachLocked = active
    ? active.status === 'sent' || sentContactIds.has(active.contact_id)
    : false

  function importPreset(presetId: string) {
    const preset = EMAIL_TEMPLATE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setSubjectTemplate(preset.subjectTemplate)
    setBodyTemplate(preset.bodyTemplate)
    setMsg(`Imported “${preset.label}” — click Save template to keep it.`)
  }

  async function load() {
    if (!user) return
    const { data } = await supabase
      .from('outreach_drafts')
      .select(
        'id, contact_id, subject, body, status, sent_at, error_message, contacts(full_name, email)',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const mapped = (data || []).map((d) => ({
      ...d,
      contacts: Array.isArray(d.contacts) ? d.contacts[0] : d.contacts,
    })) as DraftRow[]
    setDrafts(mapped)
    if (active) {
      const refreshed = mapped.find((d) => d.id === active.id) || null
      setActive(refreshed)
    } else if (orientContactId) {
      const forContact = mapped.find((d) => d.contact_id === orientContactId)
      if (forContact) setActive(forContact)
    }
    return mapped
  }

  async function completeOrientationIfNeeded(hasDraft: boolean) {
    if (!inOrientation || !hasDraft) return
    await orientation.markComplete()
    setMsg(
      'Orientation complete — the full app is unlocked. Edit, send, or generate more drafts anytime.',
    )
    if (orientContactId) {
      searchParams.delete('contact')
      setSearchParams(searchParams, { replace: true })
    }
  }

  async function generateForContact(contactId: string) {
    setGenerating(true)
    setMsg(null)
    try {
      const res = await invokeFunction<{
        drafts: DraftRow[]
        skipped_already_sent?: unknown[]
      }>('draft-emails', { contact_ids: [contactId] })
      const mapped = await load()
      const created = res.drafts?.[0]
      if (created) {
        const row =
          mapped?.find((d) => d.id === created.id) ||
          mapped?.find((d) => d.contact_id === contactId) ||
          null
        if (row) setActive(row)
        setMsg('Draft generated from your template.')
        await completeOrientationIfNeeded(true)
      } else if ((mapped || []).some((d) => d.contact_id === contactId)) {
        await completeOrientationIfNeeded(true)
      } else {
        setMsg('No draft was created — try again or check the contact has an email.')
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not generate draft')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    if (!user) return
    void (async () => {
      const [{ data: prof }, { data: resume }] = await Promise.all([
        supabase
          .from('profiles')
          .select('email_subject_template, email_body_template')
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('resumes')
          .select('file_name')
          .eq('user_id', user.id)
          .order('uploaded_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (prof?.email_subject_template?.trim()) {
        setSubjectTemplate(prof.email_subject_template.trim())
      }
      if (prof?.email_body_template?.trim()) {
        setBodyTemplate(prof.email_body_template.trim())
      }
      setResumeFileName(resume?.file_name || null)
    })()
    void load()
  }, [user])

  useEffect(() => {
    if (!user || !orientContactId || orientDraftStarted.current) return
    orientDraftStarted.current = true
    void (async () => {
      const { data: contact } = await supabase
        .from('contacts')
        .select('full_name, email')
        .eq('id', orientContactId)
        .maybeSingle()
      setContactName(contact?.full_name || contact?.email || 'this contact')

      const mapped = await load()
      const existing = mapped?.find((d) => d.contact_id === orientContactId)
      if (existing) {
        setActive(existing)
        await completeOrientationIfNeeded(true)
        return
      }
      // Wait for user to press Generate during orientation coaching
    })()
  }, [user, orientContactId])

  async function saveTemplate() {
    if (!user) return
    setSavingTemplate(true)
    setMsg(null)
    const { error } = await supabase
      .from('profiles')
      .update({
        email_subject_template: subjectTemplate.trim(),
        email_body_template: bodyTemplate.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    setSavingTemplate(false)
    if (error) setMsg(error.message)
    else setMsg('Template saved.')
  }

  async function saveEdits() {
    if (!active) return
    const { error } = await supabase
      .from('outreach_drafts')
      .update({
        subject: active.subject,
        body: active.body,
        status: 'approved',
      })
      .eq('id', active.id)
    if (error) setMsg(error.message)
    else {
      setMsg('Draft saved & marked approved.')
      void load()
    }
  }

  async function send() {
    if (!active) return
    setSending(true)
    setMsg(null)
    try {
      await invokeFunction<{
        resume_attached?: string
        sent_via?: string
      }>('send-outreach', { draft_id: active.id })
      const attachNote = resumeFileName
        ? `Sent via Gmail with ${resumeFileName} attached. Check your Sent folder.`
        : 'Sent via your Gmail — check your Sent folder.'
      setMsg(attachNote)
      void load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function regenerateDraft() {
    if (!active) return
    setRegenerating(true)
    setMsg(null)
    try {
      const res = await invokeFunction<{ drafts: DraftRow[] }>('draft-emails', {
        draft_id: active.id,
      })
      const updated = res.drafts?.[0]
      if (updated) {
        setActive({
          ...active,
          subject: updated.subject,
          body: updated.body,
          status: 'draft',
          error_message: null,
        })
        setMsg('Draft regenerated from your template.')
      } else {
        setMsg('Regenerate finished but no draft was returned.')
      }
      void load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Regenerate failed')
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div className="panel drafts-page">
      <header className="drafts-header">
        <h1>Drafts</h1>
        <p className="muted small">
          {inOrientation
            ? 'Generate an outreach draft for the contact you kept. That finishes orientation.'
            : 'Template drives new emails; pick a draft to review and send. Drafts are filled from your saved template only — no AI text.'}
        </p>
      </header>

      {inOrientation && orientContactId && (
        <div className="orientation-coach">
          <p>
            Press <strong>Generate draft</strong> for{' '}
            {contactName || 'your kept contact'}. We fill your email template
            with their name, company, and title.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={generating}
              onClick={() => void generateForContact(orientContactId)}
            >
              {generating ? 'Generating…' : 'Generate draft'}
            </button>
          </div>
        </div>
      )}

      {msg && <p className="flash drafts-flash">{msg}</p>}

      <div className="drafts-layout">
        <aside className="drafts-list-col">
          <h2 className="drafts-section-title">Drafts</h2>
          <ul className="draft-list drafts-list-compact">
            {drafts.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={`${active?.id === d.id ? 'active' : ''} ${
                    d.status === 'sent' ? 'draft-list-sent' : ''
                  }`}
                  onClick={() => setActive(d)}
                >
                  <span className="draft-list-row-top">
                    {d.status === 'sent' && (
                      <span className="draft-sent-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    <span className="draft-list-subject">{d.subject}</span>
                  </span>
                  <span className="muted small">
                    {d.contacts?.full_name || d.contacts?.email}
                    {d.status === 'sent'
                      ? ` · ${formatSentDate(d.sent_at)}`
                      : ` · ${d.status}`}
                  </span>
                </button>
              </li>
            ))}
            {drafts.length === 0 && (
              <li className="muted small">Generate from Contacts.</li>
            )}
          </ul>
        </aside>

        <section className="drafts-template-col">
          <h2 className="drafts-section-title">Active template</h2>
          <div className="template-preset-row">
            {EMAIL_TEMPLATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="btn ghost btn-sm"
                title={preset.blurb}
                onClick={() => importPreset(preset.id)}
              >
                Import: {preset.label}
              </button>
            ))}
          </div>
          <label>
            Subject
            <input
              type="text"
              value={subjectTemplate}
              onChange={(e) => setSubjectTemplate(e.target.value)}
            />
          </label>
          <label>
            Body
            <textarea
              rows={9}
              value={bodyTemplate}
              onChange={(e) => setBodyTemplate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn primary"
            disabled={savingTemplate}
            onClick={() => void saveTemplate()}
          >
            {savingTemplate ? 'Saving…' : 'Save template'}
          </button>

          <div className="drafts-review">
            <h2 className="drafts-section-title">Review & send</h2>
            <p className="muted small drafts-send-note">
              Sends from your connected Gmail. The message appears in your{' '}
              <strong>Sent</strong> mail like any email you send yourself.
              {resumeFileName
                ? ` Attaches latest resume: ${resumeFileName}.`
                : ' Upload a resume on Profile before sending.'}
            </p>
            {active ? (
              <>
                {outreachLocked && (
                  <p className="draft-sent-banner">
                    Outreach already sent to this person. Follow up or reply from
                    your Gmail inbox — FollowUp won&apos;t send again.
                  </p>
                )}
                <p className="muted small">
                  To: {active.contacts?.email} ({active.contacts?.full_name})
                </p>
                <label>
                  Subject
                  <input
                    value={active.subject}
                    disabled={outreachLocked}
                    onChange={(e) =>
                      setActive({ ...active, subject: e.target.value })
                    }
                  />
                </label>
                <label>
                  Body
                  <textarea
                    rows={8}
                    value={active.body}
                    disabled={outreachLocked}
                    onChange={(e) =>
                      setActive({ ...active, body: e.target.value })
                    }
                  />
                </label>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={regenerating || sending || outreachLocked}
                    onClick={() => void regenerateDraft()}
                  >
                    {regenerating ? '…' : 'Regenerate'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={outreachLocked}
                    onClick={saveEdits}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn primary btn-sm"
                    disabled={sending || regenerating || outreachLocked}
                    onClick={send}
                  >
                    {sending ? 'Sending…' : 'Send via Gmail'}
                  </button>
                </div>
                {active.error_message && (
                  <p className="flash error">{active.error_message}</p>
                )}
              </>
            ) : (
              <p className="muted small">Select a draft from the list.</p>
            )}
          </div>
        </section>

        <aside className="drafts-tags-col">
          <h2 className="drafts-section-title">Placeholders</h2>
          <p className="muted small">
            Use in subject/body. Empty links are dropped.
          </p>
          <ul className="template-tags-static">
            {TEMPLATE_PLACEHOLDER_HELP.map((h) => (
              <li key={h.key}>
                <code>[{h.key}]</code>
                <span>{h.description}</span>
              </li>
            ))}
          </ul>
          <div className="template-preview-compact">
            <h3 className="small">Sample preview</h3>
            <p className="muted small preview-subject">
              {templatePreview.subject}
            </p>
            <pre className="template-preview-body">{templatePreview.body}</pre>
          </div>
        </aside>
      </div>
    </div>
  )
}
