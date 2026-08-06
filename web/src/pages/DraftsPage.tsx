import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import type { DraftStatus } from '../types/database'

type DraftRow = {
  id: string
  subject: string
  body: string
  status: DraftStatus
  error_message: string | null
  contacts: { full_name: string | null; email: string | null } | null
}

export function DraftsPage() {
  const { user } = useAuth()
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [active, setActive] = useState<DraftRow | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  async function load() {
    if (!user) return
    const { data } = await supabase
      .from('outreach_drafts')
      .select('id, subject, body, status, error_message, contacts(full_name, email)')
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
    }
  }

  useEffect(() => {
    void load()
  }, [user])

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
      await invokeFunction('send-outreach', { draft_id: active.id })
      setMsg('Sent via your Gmail with resume attached.')
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
        setMsg('Draft regenerated — review before sending.')
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
    <div className="panel split">
      <section>
        <h1>Drafts</h1>
        <p className="lede">
          Review every email before it leaves your inbox. Sending attaches your
          latest resume.
        </p>
        <ul className="draft-list">
          {drafts.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className={active?.id === d.id ? 'active' : ''}
                onClick={() => setActive(d)}
              >
                <strong>{d.subject}</strong>
                <span className="muted small">
                  {d.contacts?.full_name || d.contacts?.email} · {d.status}
                </span>
              </button>
            </li>
          ))}
          {drafts.length === 0 && (
            <li className="muted">No drafts yet. Generate from Contacts.</li>
          )}
        </ul>
      </section>

      <section>
        {active ? (
          <>
            <p className="muted small">
              To: {active.contacts?.email} ({active.contacts?.full_name})
            </p>
            <label>
              Subject
              <input
                value={active.subject}
                onChange={(e) =>
                  setActive({ ...active, subject: e.target.value })
                }
              />
            </label>
            <label>
              Body
              <textarea
                rows={14}
                value={active.body}
                onChange={(e) => setActive({ ...active, body: e.target.value })}
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={
                  regenerating || sending || active.status === 'sent'
                }
                onClick={() => void regenerateDraft()}
              >
                {regenerating ? 'Regenerating…' : 'Regenerate draft'}
              </button>
              <button type="button" className="btn" onClick={saveEdits}>
                Save / approve
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={sending || regenerating || active.status === 'sent'}
                onClick={send}
              >
                {sending ? 'Sending…' : 'Confirm & send via Gmail'}
              </button>
            </div>
            {active.error_message && (
              <p className="flash error">{active.error_message}</p>
            )}
          </>
        ) : (
          <p className="muted">Select a draft to edit.</p>
        )}
        {msg && <p className="flash">{msg}</p>}
      </section>
    </div>
  )
}
