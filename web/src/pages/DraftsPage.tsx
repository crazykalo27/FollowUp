import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import { prefillSpecificCompanySearch } from '../lib/searchDepth'
import { formatPendingTimer } from '../lib/outreachDelivery'
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
  bounce_summary: string | null
  contacts: {
    full_name: string | null
    email: string | null
    companies: { name: string } | { name: string }[] | null
  } | null
}

function companyNameFromDraft(d: DraftRow): string | null {
  const c = d.contacts?.companies
  if (!c) return null
  if (Array.isArray(c)) return c[0]?.name || null
  return c.name || null
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
  const navigate = useNavigate()
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
  const focusedContactRef = useRef<string | null>(null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [gmailEmail, setGmailEmail] = useState<string | null>(null)
  const [connectingGmail, setConnectingGmail] = useState(false)
  const [copied, setCopied] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [clock, setClock] = useState(() => Date.now())

  const pendingCount = useMemo(
    () => drafts.filter((d) => d.status === 'pending').length,
    [drafts],
  )

  const templatePreview = useMemo(() => {
    return {
      subject: applyTemplate(subjectTemplate, SAMPLE_PREVIEW_VARS),
      body: applyTemplate(bodyTemplate, SAMPLE_PREVIEW_VARS),
    }
  }, [subjectTemplate, bodyTemplate])

  const lockedContactIds = useMemo(
    () =>
      new Set(
        drafts
          .filter((d) => d.status === 'sent' || d.status === 'pending')
          .map((d) => d.contact_id),
      ),
    [drafts],
  )

  const outreachLocked = active
    ? active.status === 'sent' ||
      active.status === 'pending' ||
      lockedContactIds.has(active.contact_id)
    : false

  const isBounced = active?.status === 'bounced'
  const isPending = active?.status === 'pending'

  async function syncDeliveryStatus() {
    if (!user) return
    const { data: gmail } = await supabase
      .from('gmail_connection')
      .select('email')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!gmail?.email) return
    try {
      await invokeFunction('check-outreach-replies', {})
    } catch {
      // optional sync — ignore if scope not granted yet
    }
  }

  function findNewPersonAtCompany(companyName: string) {
    prefillSpecificCompanySearch(companyName)
    navigate(`/app/search?company=${encodeURIComponent(companyName)}`)
  }

  function importPreset(presetId: string) {
    const preset = EMAIL_TEMPLATE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setSubjectTemplate(preset.subjectTemplate)
    setBodyTemplate(preset.bodyTemplate)
    setMsg(`Imported “${preset.label}” — click Save template to keep it.`)
  }

  async function load(preferredContactId?: string | null) {
    if (!user) return
    const focusId = preferredContactId ?? orientContactId
    const { data } = await supabase
      .from('outreach_drafts')
      .select(
        'id, contact_id, subject, body, status, sent_at, error_message, bounce_summary, contacts(full_name, email, companies(name))',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    const mapped = (data || []).map((d) => ({
      ...d,
      contacts: Array.isArray(d.contacts) ? d.contacts[0] : d.contacts,
    })) as DraftRow[]
    setDrafts(mapped)

    if (focusId) {
      const forContact = mapped.find((d) => d.contact_id === focusId)
      if (forContact) {
        setActive(forContact)
        return mapped
      }
    }
    if (active) {
      const refreshed = mapped.find((d) => d.id === active.id) || null
      setActive(refreshed)
    }
    return mapped
  }

  useEffect(() => {
    if (pendingCount === 0) return
    const tick = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [pendingCount])

  useEffect(() => {
    if (!user || pendingCount === 0) return
    const run = () => {
      void syncDeliveryStatus().then(() => load())
    }
    run()
    const poll = window.setInterval(run, 30_000)
    return () => window.clearInterval(poll)
  }, [user, pendingCount])

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
    // Optional Gmail connect prompt (not required)
    const { data: gmail } = await supabase
      .from('gmail_connection')
      .select('email')
      .eq('user_id', user!.id)
      .maybeSingle()
    setGmailEmail(gmail?.email || null)
    setCompleteOpen(true)
  }

  async function connectGmail() {
    setConnectingGmail(true)
    try {
      const res = await invokeFunction<{ url: string }>('gmail-oauth')
      window.location.href = res.url
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not start Gmail OAuth')
      setConnectingGmail(false)
    }
  }

  async function copyActiveDraft() {
    if (!active) return
    const to = active.contacts?.email ? `To: ${active.contacts.email}\n` : ''
    const text = `${to}Subject: ${active.subject}\n\n${active.body}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setMsg('Draft copied — paste into your email client anytime.')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setMsg('Could not copy — select the draft text manually.')
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
    if (inOrientation) setTemplateOpen(true)
  }, [inOrientation])

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
    void (async () => {
      await syncDeliveryStatus()
      await load(orientContactId)
    })()
  }, [user])

  // Deep-link from Contacts "Go to drafts" (or orientation) → select that contact's draft
  useEffect(() => {
    if (!user || !orientContactId) return
    if (focusedContactRef.current === orientContactId) return
    focusedContactRef.current = orientContactId
    void (async () => {
      const { data: contact } = await supabase
        .from('contacts')
        .select('full_name, email')
        .eq('id', orientContactId)
        .maybeSingle()
      setContactName(contact?.full_name || contact?.email || 'this contact')

      const mapped = await load(orientContactId)
      const existing = mapped?.find((d) => d.contact_id === orientContactId)
      if (existing) {
        setActive(existing)
        if (inOrientation) {
          await completeOrientationIfNeeded(true)
        }
      }
    })()
  }, [user, orientContactId, inOrientation])

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
        ? `Sent via Gmail — checking delivery (about 5 min). ${resumeFileName} attached.`
        : 'Sent via Gmail — checking delivery for about 5 minutes.'
      setMsg(attachNote)
      await syncDeliveryStatus()
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

      <div
        className={`drafts-template-shell${templateOpen ? ' is-open' : ''}`}
      >
        <button
          type="button"
          className="drafts-template-toggle"
          aria-expanded={templateOpen}
          onClick={() => setTemplateOpen((o) => !o)}
        >
          <span
            className={`drafts-template-chevron${templateOpen ? ' open' : ''}`}
            aria-hidden
          />
          <span className="drafts-template-toggle-text">
            <span className="drafts-template-toggle-label">Email template</span>
            <span className="drafts-template-toggle-hint muted small">
              {templateOpen
                ? 'New drafts use this wording — collapse when you’re reviewing.'
                : subjectTemplate.trim() || 'Set subject & body for new drafts'}
            </span>
          </span>
          {!templateOpen && (
            <span className="drafts-template-toggle-action btn ghost btn-sm">
              Edit template
            </span>
          )}
        </button>

        {templateOpen && (
          <div className="drafts-template-drawer" id="drafts-template-drawer">
            <div className="drafts-template-panel">
              <div className="drafts-template-edit">
                <div className="template-preset-row">
                  {EMAIL_TEMPLATE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="btn ghost btn-sm"
                      title={preset.blurb}
                      onClick={() => importPreset(preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <label>
                  Subject line
                  <input
                    type="text"
                    value={subjectTemplate}
                    onChange={(e) => setSubjectTemplate(e.target.value)}
                  />
                </label>
                <label>
                  Body
                  <textarea
                    rows={8}
                    value={bodyTemplate}
                    onChange={(e) => setBodyTemplate(e.target.value)}
                  />
                </label>
                <div className="actions drafts-template-actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={savingTemplate}
                    onClick={() => void saveTemplate()}
                  >
                    {savingTemplate ? 'Saving…' : 'Save template'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setTemplateOpen(false)}
                  >
                    Done
                  </button>
                </div>
              </div>

              <aside className="drafts-template-sidebar">
                <h3 className="drafts-section-title">Placeholders</h3>
                <p className="muted small">
                  Use in subject or body. Empty links are dropped.
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
                  <pre className="template-preview-body">
                    {templatePreview.body}
                  </pre>
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>

      <div className="drafts-workspace">
        <aside className="drafts-list-col" aria-label="Outbox">
          <h2 className="drafts-section-title">Outbox</h2>
          <p className="muted small drafts-list-hint">
            {drafts.length} draft{drafts.length === 1 ? '' : 's'}
          </p>
          <ul className="draft-list drafts-list-compact">
            {drafts.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={`${active?.id === d.id ? 'active' : ''} ${
                    d.status === 'sent' ? 'draft-list-sent' : ''
                  } ${d.status === 'pending' ? 'draft-list-pending' : ''} ${
                    d.status === 'bounced' ? 'draft-list-bounced' : ''
                  }`}
                  onClick={() => setActive(d)}
                >
                  <span className="draft-list-row-top">
                    {d.status === 'pending' && (
                      <span className="draft-pending-mark" aria-hidden="true">
                        ◷
                      </span>
                    )}
                    {d.status === 'sent' && (
                      <span className="draft-sent-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                    {d.status === 'bounced' && (
                      <span className="draft-bounced-mark" aria-hidden="true">
                        !
                      </span>
                    )}
                    <span className="draft-list-subject">{d.subject}</span>
                  </span>
                  <span className="muted small">
                    {d.contacts?.full_name || d.contacts?.email}
                    {d.status === 'sent'
                      ? ` · ${formatSentDate(d.sent_at)}`
                      : d.status === 'pending'
                        ? ` · ${formatPendingTimer(d.sent_at, clock)}`
                        : d.status === 'bounced'
                          ? ' · delivery failed'
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

        <section className="drafts-editor" aria-label="Current draft">
          {active ? (
            <>
              <header className="drafts-editor-head">
                <div>
                  <p className="drafts-section-title drafts-editor-kicker">
                    Current draft
                  </p>
                  <h2 className="drafts-editor-recipient">
                    {active.contacts?.full_name || 'Contact'}
                  </h2>
                  <p className="muted small drafts-editor-to">
                    {active.contacts?.email || 'No email on file'}
                    {active.status === 'sent'
                      ? ` · ${formatSentDate(active.sent_at)}`
                      : active.status === 'pending'
                        ? ` · ${formatPendingTimer(active.sent_at, clock)}`
                        : active.status === 'bounced'
                          ? ' · delivery failed (not counted as sent)'
                          : ` · ${active.status}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn ghost btn-sm"
                  onClick={() => setTemplateOpen(true)}
                >
                  Template
                </button>
              </header>

              {outreachLocked && !isBounced && !isPending && (
                <p className="draft-sent-banner">
                  Outreach already sent to this person. Follow up or reply from
                  your Gmail inbox — FollowUp won&apos;t send again.
                </p>
              )}

              {isPending && (
                <div className="draft-pending-banner">
                  <p>
                    <strong>Delivery pending.</strong> We&apos;re watching this
                    thread for bounces. If nothing fails, it turns green after 5
                    minutes.
                  </p>
                  <p className="draft-pending-timer">
                    {formatPendingTimer(active.sent_at, clock)}
                  </p>
                </div>
              )}

              {isBounced && (
                <div className="draft-bounced-banner">
                  <p>
                    Gmail reported a delivery failure for this address (wrong
                    email or mailbox not found). This does{' '}
                    <strong>not</strong> count as a successful send.
                  </p>
                  {active.bounce_summary && (
                    <p className="muted small">Detected: {active.bounce_summary}</p>
                  )}
                  {companyNameFromDraft(active) ? (
                    <div className="actions" style={{ marginTop: '0.65rem' }}>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() =>
                          findNewPersonAtCompany(companyNameFromDraft(active)!)
                        }
                      >
                        Find new person at this company
                      </button>
                    </div>
                  ) : (
                    <p className="muted small">
                      No company on file — run a specific search from Search.
                    </p>
                  )}
                </div>
              )}

              <div className="drafts-editor-fields">
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
                <label className="drafts-editor-body-label">
                  Message
                  <textarea
                    rows={14}
                    value={active.body}
                    disabled={outreachLocked}
                    onChange={(e) =>
                      setActive({ ...active, body: e.target.value })
                    }
                  />
                </label>
              </div>

              <p className="muted small drafts-send-note">
                Sends from your connected Gmail and appears in{' '}
                <strong>Sent</strong>.
                {resumeFileName
                  ? ` Attaches ${resumeFileName}.`
                  : ' Upload a resume on Profile before sending.'}
              </p>

              <div className="drafts-editor-toolbar actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void copyActiveDraft()}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={regenerating || sending || outreachLocked}
                  onClick={() => void regenerateDraft()}
                >
                  {regenerating ? 'Regenerating…' : 'Regenerate'}
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
                  className="btn primary"
                  disabled={sending || regenerating || outreachLocked || isBounced}
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
            <div className="drafts-editor-empty">
              <h2 className="drafts-editor-recipient">Pick a draft</h2>
              <p className="muted">
                Choose someone from the outbox, or create drafts from Contacts.
              </p>
            </div>
          )}
        </section>
      </div>

      {completeOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setCompleteOpen(false)}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="orient-complete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="orient-complete-title">Orientation complete</h2>
            <p>
              Your first draft is ready. To send emails straight from FollowUp,
              connect the Gmail account you want to send from. This is optional —
              you can also copy the draft and send it yourself.
            </p>
            {gmailEmail ? (
              <p className="muted small">Already connected as {gmailEmail}.</p>
            ) : null}
            <div className="actions">
              {!gmailEmail && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={connectingGmail}
                  onClick={() => void connectGmail()}
                >
                  {connectingGmail ? 'Redirecting…' : 'Connect Gmail'}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={!active}
                onClick={() => void copyActiveDraft()}
              >
                {copied ? 'Copied' : 'Copy draft'}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCompleteOpen(false)}
              >
                Continue without connecting
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
