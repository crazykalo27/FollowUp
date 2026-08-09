import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import { FollowUpLogo } from '../components/FollowUpLogo'
import { ProfileCoachAvatar } from '../components/ProfileCoachAvatar'
import type { SearchProfileData } from '../types/database'
import './profile.css'

type Msg = { role: 'user' | 'assistant'; content: string }

/** Closed-ended orientation steps get click-to-send options; open-ended stay text-only. */
const ORIENTATION_QUICK_OPTIONS: Record<string, string[]> = {
  locations: ['No preference'],
  employment_types: ['Full-time', 'Part-time', 'Internship'],
  remote_preference: ['Remote', 'In-person', 'Hybrid'],
  company_size: ['Large', 'Medium', 'Small'],
  seniority: ['Entry', 'Mid-level', 'Experienced'],
}

const QUICK_ANSWER_HINT = 'Type or press the buttons below to respond.'

const ORIENTATION_QUESTION_KEYS = [
  'locations',
  'employment_types',
  'remote_preference',
  'company_size',
  'seniority',
  'industries',
  'roles',
] as const

function orientationQuickOptions(
  profile: SearchProfileData | null,
  seriesComplete: boolean,
  orientationComplete: boolean,
): string[] | null {
  if (orientationComplete || seriesComplete || !profile) return null
  const q = profile.orientation_q ?? 0
  if (q < 0 || q >= ORIENTATION_QUESTION_KEYS.length) return null
  const key = ORIENTATION_QUESTION_KEYS[q]
  const options = ORIENTATION_QUICK_OPTIONS[key]
  return options?.length ? options : null
}

function ChatMessage({ role, content }: Msg) {
  if (role === 'user') {
    return (
      <div className="coach-msg coach-msg-user">
        <div className="coach-bubble">{content}</div>
      </div>
    )
  }

  return (
    <div className="coach-msg coach-msg-assistant">
      <ProfileCoachAvatar size={36} />
      <div className="coach-msg-body">
        <span className="coach-msg-name">FollowUp</span>
        <div className="coach-bubble">{content}</div>
      </div>
    </div>
  )
}

export function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const [loading, setLoading] = useState(true)
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
    let cancelled = false
    ;(async () => {
      setLoading(true)
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

      if (cancelled) return

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
      setLoading(false)

      if (resume && loaded.length === 0 && !bootstrapAttempted.current) {
        bootstrapAttempted.current = true
        await bootstrapChat()
      }
    })()
    return () => {
      cancelled = true
    }
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

  async function send(finalize = false, preset?: string) {
    const message = (preset ?? input).trim()
    if (!finalize && !message) return
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

  const quickOptions = orientationQuickOptions(
    profile,
    seriesComplete,
    orientation.complete,
  )
  const lastAssistantText = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant')?.content
  const showQuickHint =
    Boolean(quickOptions) &&
    !lastAssistantText?.includes(QUICK_ANSWER_HINT)

  if (loading) {
    return <div className="page-center muted">Loading profile…</div>
  }

  if (!fileName) {
    return (
      <div className="profile-page profile-upload-stage">
        <div className="profile-upload-card">
          <ProfileCoachAvatar size={52} />
          <h1>Start with your resume</h1>
          <p className="profile-upload-lede">
            Upload your resume and chat with your FollowUp guide to shape who we
            search for. You can return anytime to change roles, industries,
            locations, and outreach targets.
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
      </div>
    )
  }

  const showSaveProfile =
    !orientation.complete && seriesComplete && !ready

  return (
    <div className="profile-page">
      <div className="profile-chat-shell">
        <header className="profile-chat-header">
          <div className="profile-chat-brand">
            <FollowUpLogo size={22} alt="" />
            <span>FollowUp AI</span>
          </div>
          <div className="profile-guide-meta">
            <span className="profile-resume-chip" title={fileName}>
              {fileName}
            </span>
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
          </div>
        </header>
        <div className="profile-chat-main" ref={chatLogRef}>
          {seriesComplete && showSaveProfile && (
            <p className="profile-series-banner">
              Interview complete. Add any final details below, or save your profile
              to continue to Filters.
            </p>
          )}

          <div className="coach-log">
            {messages.length === 0 && bootstrapping && (
              <div className="coach-thinking">
                <ProfileCoachAvatar size={32} />
                <span>Reading your resume and preparing questions…</span>
              </div>
            )}
            {messages.map((m, i) => (
              <ChatMessage key={i} role={m.role} content={m.content} />
            ))}
            {busy && messages.length > 0 && (
              <div className="coach-thinking">
                <ProfileCoachAvatar size={32} />
                <span>Thinking…</span>
              </div>
            )}
          </div>
        </div>

        {quickOptions && (
          <div className="profile-quick-panel">
            {showQuickHint && (
              <p className="profile-quick-hint">{QUICK_ANSWER_HINT}</p>
            )}
            <div
              className="profile-quick-answers"
              role="group"
              aria-label="Quick answers"
            >
              {quickOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className="profile-quick-btn"
                  disabled={busy || bootstrapping}
                  onClick={() => void send(false, opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        <footer className="profile-chat-compose">
          <div className="profile-compose-row">
            <textarea
              rows={1}
              value={input}
              placeholder={
                orientation.complete
                  ? 'Tell me what to change about your search…'
                  : seriesComplete
                    ? 'Optional: clarify anything else…'
                    : quickOptions
                      ? 'Or type your own answer…'
                      : 'Type your answer…'
              }
              disabled={bootstrapping || busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send(false)
                }
              }}
            />
            <button
              type="button"
              className="btn primary profile-compose-send"
              disabled={busy || bootstrapping || !input.trim()}
              onClick={() => send(false)}
            >
              {busy ? '…' : 'Send'}
            </button>
          </div>
          <p className="profile-compose-hint">
            {quickOptions
              ? 'Tap an option to send · or type and press Enter'
              : 'Enter to send · Shift+Enter for a new line'}
          </p>
          {showSaveProfile && (
            <div className="profile-compose-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || bootstrapping}
                onClick={() => send(true)}
              >
                {busy ? 'Saving…' : 'Save profile'}
              </button>
            </div>
          )}
          {status && <p className="flash">{status}</p>}
        </footer>
      </div>
    </div>
  )
}
