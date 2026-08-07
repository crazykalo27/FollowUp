import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import type { SearchProfileData } from '../types/database'

type Msg = { role: 'user' | 'assistant'; content: string }

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const [fileName, setFileName] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [profile, setProfile] = useState<SearchProfileData | null>(null)
  const [ready, setReady] = useState(false)
  const [seriesComplete, setSeriesComplete] = useState(false)
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
        series_complete?: boolean
        already_started?: boolean
        filters?: unknown
      }>('chat-profile', { action: 'bootstrap' })
      if (res.profile) setProfile(res.profile)
      if (res.ready) setReady(true)
      if (res.series_complete) setSeriesComplete(true)
      if (res.reply && !res.already_started) {
        setMessages((m) =>
          m.length === 0 ? [{ role: 'assistant', content: res.reply! }] : m,
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
      if (sp?.profile) {
        const p = sp.profile as SearchProfileData
        setProfile(p)
        if ((p.orientation_q ?? 0) >= 7) setSeriesComplete(true)
      }
      if (prof?.onboarding_complete) {
        setReady(true)
        setSeriesComplete(true)
      }

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
      setStatus('Scanning your resume…')

      await supabase.from('profile_chat_messages').delete().eq('user_id', user.id)
      setMessages([])
      setReady(false)
      setSeriesComplete(false)
      bootstrapAttempted.current = true
      await bootstrapChat()
      setStatus(null)
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
          content: message || 'Save my profile.',
        },
      ])
    }
    setBusy(true)
    try {
      const res = await invokeFunction<{
        reply: string
        profile: SearchProfileData | null
        ready?: boolean
        series_complete?: boolean
        filters?: unknown
      }>('chat-profile', {
        action: finalize ? 'finalize' : 'reply',
        message: message || undefined,
        finalize,
      })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      if (res.profile) setProfile(res.profile)
      if (res.series_complete) setSeriesComplete(true)
      if (res.ready) {
        setReady(true)
        await orientation.advanceTo('filters')
        setStatus('Profile saved — review your filters next.')
        navigate('/app/filters')
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Chat failed')
    } finally {
      setBusy(false)
    }
  }

  // Pre-upload: purpose + central upload
  if (!fileName) {
    return (
      <div className="profile-hero">
        <p className="profile-purpose">
          Find direct contacts to land jobs
        </p>
        <p className="lede profile-purpose-sub">
          Upload your resume. We scan it, ask a few questions, then help you
          reach hiring managers — not application black holes.
        </p>
        <label className="upload upload-hero">
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt,application/pdf,text/plain"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onUpload(f)
            }}
          />
          <span>{uploading ? 'Uploading…' : 'Upload resume'}</span>
        </label>
        {status && <p className="flash error">{status}</p>}
      </div>
    )
  }

  return (
    <div className="profile-layout profile-layout-focus">
      <header className="profile-top">
        <div>
          <h1>Profile</h1>
          <p className="lede">
            Answer each question so we know who to find. When the series is
            done, save your profile to continue.
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
              {uploading || bootstrapping ? 'Working…' : 'Replace resume'}
            </span>
          </label>
          <p className="muted small">Current: {fileName}</p>
        </div>
        {status && <p className="flash">{status}</p>}
      </header>

      <div className="profile-body profile-body-single">
        <section className="chat chat-pane" aria-label="Profile chat">
          <div className="chat-log" ref={chatLogRef}>
            {messages.length === 0 && bootstrapping && (
              <p className="muted">Scanning resume and starting orientation…</p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
          </div>

          {seriesComplete && !ready && (
            <div className="next-prompt">
              <p>
                Profile interview complete. Clarify anything else below, or
                press Save profile to continue to Filters.
              </p>
            </div>
          )}

          <div className="chat-compose">
            <textarea
              rows={3}
              value={input}
              placeholder={
                seriesComplete
                  ? 'Optional: clarify anything else…'
                  : 'Answer the question above…'
              }
              disabled={bootstrapping}
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
                className="btn"
                disabled={busy || bootstrapping || !input.trim()}
                onClick={() => send(false)}
              >
                Send
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={
                  busy || bootstrapping || !seriesComplete || ready
                }
                onClick={() => send(true)}
              >
                {busy && seriesComplete ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          </div>
        </section>

        {!orientation.complete && profile && (
          <aside className="profile-side profile-side-thin">
            <h3>So far</h3>
            <div className="profile-side-summary">
              {profile.locations?.length > 0 && (
                <p>
                  <strong>Locations:</strong> {profile.locations.join(', ')}
                </p>
              )}
              {(profile.employment_types?.length ?? 0) > 0 && (
                <p>
                  <strong>Job type:</strong>{' '}
                  {(profile.employment_types ?? []).join(', ')}
                </p>
              )}
              {profile.remote_preference && (
                <p>
                  <strong>Work style:</strong> {profile.remote_preference}
                </p>
              )}
              {profile.company_size && (
                <p>
                  <strong>Company size:</strong> {profile.company_size}
                </p>
              )}
              {profile.seniority && (
                <p>
                  <strong>Seniority:</strong> {profile.seniority}
                </p>
              )}
              {profile.industries?.length > 0 && (
                <p>
                  <strong>Industries:</strong> {profile.industries.join(', ')}
                </p>
              )}
              {profile.roles?.length > 0 && (
                <p>
                  <strong>Titles:</strong> {profile.roles.join(', ')}
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
