import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import type { SearchProfileData } from '../types/database'

type Msg = { role: 'user' | 'assistant'; content: string }

export function OnboardingPage() {
  const { user } = useAuth()
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [profile, setProfile] = useState<SearchProfileData | null>(null)
  const [ready, setReady] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const chatLogRef = useRef<HTMLDivElement>(null)
  const bootstrapAttempted = useRef(false)

  async function bootstrapChat() {
    setBootstrapping(true)
    setStatus(null)
    try {
      const res = await invokeFunction<{
        reply: string | null
        profile: SearchProfileData
        ready?: boolean
        already_started?: boolean
        filters?: unknown
      }>('chat-profile', { action: 'bootstrap' })
      if (res.profile) setProfile(res.profile)
      if (res.ready) setReady(true)
      if (res.reply && !res.already_started) {
        setMessages((m) =>
          m.length === 0 ? [{ role: 'assistant', content: res.reply! }] : m,
        )
        setStatus(
          'Confirm target jobs and industries with a reply — required before search.',
        )
      } else if (res.reply && res.already_started) {
        setMessages((m) => {
          if (m.length > 0) return m
          return [{ role: 'assistant', content: res.reply! }]
        })
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not start profile chat')
    } finally {
      setBootstrapping(false)
    }
  }

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const [{ data: resume }, { data: chat }, { data: sp }, { data: prof }] =
        await Promise.all([
          supabase
            .from('resumes')
            .select('file_name')
            .eq('user_id', user.id)
            .order('uploaded_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('profile_chat_messages')
            .select('role, content')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true }),
          supabase
            .from('search_profiles')
            .select('profile')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('onboarding_complete')
            .eq('id', user.id)
            .maybeSingle(),
        ])

      if (resume) setFileName(resume.file_name)
      if (sp?.profile) setProfile(sp.profile as SearchProfileData)
      if (prof?.onboarding_complete) setReady(true)

      const loaded: Msg[] = (chat || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      setMessages(loaded)

      if (resume && loaded.length === 0 && !bootstrapAttempted.current) {
        bootstrapAttempted.current = true
        await bootstrapChat()
      }
    })()
  }, [user])

  useEffect(() => {
    const el = chatLogRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, bootstrapping])

  async function onUpload(file: File) {
    if (!user) return
    setUploading(true)
    setStatus(null)
    try {
      const path = `${user.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage
        .from('resumes')
        .upload(path, file, { upsert: true })
      if (upErr) throw upErr

      const { data: row, error } = await supabase
        .from('resumes')
        .insert({
          user_id: user.id,
          storage_path: path,
          file_name: file.name,
        })
        .select('*')
        .single()
      if (error) throw error

      setFileName(file.name)
      await invokeFunction('parse-resume', { resume_id: row.id })
      setStatus('Resume uploaded. Starting your profile interview…')

      await supabase.from('profile_chat_messages').delete().eq('user_id', user.id)
      setMessages([])
      setReady(false)
      bootstrapAttempted.current = true
      await bootstrapChat()
      setStatus('Resume scanned. Confirm the proposed roles to continue.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function send(finalize = false) {
    if (!finalize && !input.trim()) return
    const message = input.trim()
    setInput('')
    if (!finalize && message) {
      setMessages((m) => [...m, { role: 'user', content: message }])
    } else if (finalize) {
      setMessages((m) => [
        ...m,
        {
          role: 'user',
          content: message || 'Use what you have — lock the profile.',
        },
      ])
    }
    setBusy(true)
    try {
      const res = await invokeFunction<{
        reply: string
        profile: SearchProfileData | null
        ready?: boolean
        filters?: unknown
      }>('chat-profile', {
        action: finalize ? 'finalize' : 'reply',
        message: message || undefined,
        finalize,
      })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      if (res.profile) setProfile(res.profile)
      if (res.ready) {
        setReady(true)
        setStatus(
          'Profile ready — searching companies hiring for your confirmed roles. Tweak filters anytime.',
        )
      } else if (res.filters) {
        setStatus(
          'Roles confirmed — contact filters updated from your profile. Continue chatting or lock when ready.',
        )
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Chat failed')
    } finally {
      setBusy(false)
    }
  }

  const hasUserReply = messages.some((m) => m.role === 'user')
  const awaitingRoleConfirm =
    Boolean(fileName) &&
    Boolean(profile) &&
    !profile?.roles_confirmed &&
    !hasUserReply &&
    !ready

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

  return (
    <div className="profile-layout">
      <header className="profile-top">
        <div>
          <h1>Profile</h1>
          <p className="lede">
            Upload your resume as context. We infer jobs and industries you want,
            then chat to nail company types and who to email — not a skills
            checklist.
          </p>
        </div>
        <div className="profile-top-actions">
          <label className="upload">
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt,application/pdf,text/plain"
              disabled={uploading || bootstrapping}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onUpload(f)
              }}
            />
            <span>
              {uploading || bootstrapping ? 'Working…' : 'Choose resume'}
            </span>
          </label>
          {fileName && <p className="muted small">Current: {fileName}</p>}
        </div>
        {status && <p className="flash">{status}</p>}
      </header>

      <div className="profile-body">
        <section className="chat chat-pane" aria-label="Profile chat">
          <div className="chat-log" ref={chatLogRef}>
            {!fileName && messages.length === 0 && (
              <p className="muted">Upload a resume to begin.</p>
            )}
            {fileName && messages.length === 0 && bootstrapping && (
              <p className="muted">
                Scanning resume and drafting target roles for you to confirm…
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
          </div>

          {lastAssistant && !ready && (
            <div className="next-prompt">
              <span className="muted small">Your turn</span>
              <p>
                {awaitingRoleConfirm
                  ? 'Confirm the roles above, or tell us what to change — required before search.'
                  : 'Reply below — or lock the profile as-is.'}
              </p>
            </div>
          )}

          <div className="chat-compose">
            <textarea
              rows={3}
              value={input}
              placeholder={
                ready
                  ? 'Optional: refine your profile…'
                  : awaitingRoleConfirm
                    ? 'e.g. “Keep those” or “Focus on quantum software engineer roles”…'
                    : 'Answer the question above…'
              }
              disabled={!fileName || bootstrapping}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(false)
                }
              }}
            />
            <div className="actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || bootstrapping || !fileName || !input.trim()}
                onClick={() => send(false)}
              >
                Send
              </button>
              <button
                type="button"
                className="btn"
                disabled={
                  busy ||
                  bootstrapping ||
                  !fileName ||
                  !profile ||
                  awaitingRoleConfirm
                }
                title={
                  awaitingRoleConfirm
                    ? 'Confirm or change roles with a message first'
                    : undefined
                }
                onClick={() => send(true)}
              >
                Use profile as-is
              </button>
            </div>
          </div>
        </section>

        <aside className="profile-side">
          <h3>{ready ? 'Ready to search' : 'Search targets'}</h3>
          <p className="muted small">
            <Link to="/app/filters">Edit on Filters</Link>
          </p>
          {profile ? (
            <div className="profile-side-summary">
              {profile.roles?.length > 0 && (
                <p>
                  <strong>Jobs wanted:</strong> {profile.roles.join(', ')}
                </p>
              )}
              {profile.industries?.length > 0 && (
                <p>
                  <strong>Industries:</strong> {profile.industries.join(', ')}
                </p>
              )}
              {(profile.company_types?.length ?? 0) > 0 && (
                <p>
                  <strong>Company types:</strong>{' '}
                  {(profile.company_types ?? []).join(', ')}
                </p>
              )}
              {(profile.outreach_targets?.length ?? 0) > 0 && (
                <p>
                  <strong>People to find:</strong>{' '}
                  {(profile.outreach_targets ?? []).join(', ')}
                </p>
              )}
              {(profile.employment_types?.length ?? 0) > 0 && (
                <p>
                  <strong>Looking for:</strong>{' '}
                  {(profile.employment_types ?? []).join(', ')}
                  {profile.remote_preference
                    ? ` · ${profile.remote_preference}`
                    : ''}
                </p>
              )}
              {profile.notes && (
                <p className="muted small">{profile.notes}</p>
              )}
            </div>
          ) : (
            <p className="muted">Upload a resume to start.</p>
          )}
        </aside>
      </div>
    </div>
  )
}
