import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import { useSearchProfiles } from '../lib/searchProfileContext'
import { attachResumeToProfile, resumeFileName } from '../lib/searchProfiles'
import { SearchProfilesModal } from '../components/SearchProfilesModal'
import { FollowUpLogo } from '../components/FollowUpLogo'
import { ProfileCoachAvatar } from '../components/ProfileCoachAvatar'
import type { SearchProfileData } from '../types/database'
import {
  QUICK_ANSWER_HINT,
  orientationQuickOptions,
} from '../lib/orientationQuickAnswers'
import './profile.css'

type Msg = { role: 'user' | 'assistant'; content: string }

/** Sent when user taps Confirm on industries / job titles */
const CONFIRM_SUGGESTED_LIST =
  'Confirm — use the list above as-is.'

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
  const searchProfiles = useSearchProfiles()
  const [managerOpen, setManagerOpen] = useState(false)
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
  const lastProfileId = useRef<string | null>(null)

  async function bootstrapChat(resumeId?: string) {
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
      }>('chat-profile', {
        action: 'bootstrap',
        ...(resumeId ? { resume_id: resumeId } : {}),
      })
      if (res.profile) setProfile(res.profile)
      if (typeof res.series_complete === 'boolean') {
        setSeriesComplete(res.series_complete)
      }
      if (res.ready) setReady(true)
      if (res.reply) {
        setMessages((m) =>
          m.length === 0 ? [{ role: 'assistant', content: res.reply! }] : m,
        )
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not start profile chat')
    } finally {
      setBootstrapping(false)
    }
  }

  useEffect(() => {
    if (!user || searchProfiles.loading) return
    const active = searchProfiles.active
    const activeId = active?.id || null
    if (lastProfileId.current && lastProfileId.current !== activeId) {
      bootstrapAttempted.current = false
      setMessages([])
      setProfile(null)
      setSeriesComplete(false)
    }
    lastProfileId.current = activeId
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [{ data: chat }, { data: sp }, { data: prof }] =
        await Promise.all([
          supabase
            .from('profile_chat_messages')
            .select('role, content')
            .eq('user_id', user.id)
            .eq('search_profile_id', activeId || '')
            .order('created_at', { ascending: true }),
          supabase
            .from('search_profiles')
            .select('profile, resume_id, resumes(file_name)')
            .eq('user_id', user.id)
            .eq('is_active', true)
            .maybeSingle(),
          supabase
            .from('profiles')
            .select('onboarding_complete')
            .eq('id', user.id)
            .maybeSingle(),
        ])

      if (cancelled) return

      const resumeName = (() => {
        const r = sp?.resumes as
          | { file_name: string }
          | { file_name: string }[]
          | null
        if (!r) return active ? resumeFileName(active) : null
        return Array.isArray(r) ? r[0]?.file_name : r.file_name
      })()
      if (resumeName) setFileName(resumeName)
      else setFileName(null)
      if (sp?.profile) {
        const p = sp.profile as SearchProfileData
        const q = Number(p.orientation_q ?? 0)
        setProfile({
          ...p,
          orientation_q: Number.isFinite(q) ? q : 0,
        })
        // Only mark interview done from the profile counter — not from
        // leftover onboarding_complete / drafts on the account.
        if (Number.isFinite(q) && q >= 7) setSeriesComplete(true)
      }
      if (prof?.onboarding_complete) {
        setReady(true)
      }

      const loaded: Msg[] = (chat || [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      setMessages(loaded)
      setLoading(false)

      if (resumeName && loaded.length === 0 && !bootstrapAttempted.current) {
        bootstrapAttempted.current = true
        await bootstrapChat()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, searchProfiles.loading, searchProfiles.active])

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

      const activeId = searchProfiles.active?.id
      if (activeId && !searchProfiles.active?.resume_id) {
        await attachResumeToProfile(activeId, row.id)
        await searchProfiles.refresh()
      }

      setFileName(file.name)
      const parsed = await invokeFunction<{ ok?: boolean; chars?: number }>(
        'parse-resume',
        { resume_id: row.id },
      )
      if (!parsed.chars || parsed.chars < 40) {
        setStatus(
          'Resume text was hard to read — try PDF export or .txt/.docx for best results. Continuing with what we extracted.',
        )
      } else {
        setStatus('Scanning your resume…')
      }

      if (activeId) {
        await supabase
          .from('profile_chat_messages')
          .delete()
          .eq('user_id', user.id)
          .eq('search_profile_id', activeId)
      } else {
        await supabase.from('profile_chat_messages').delete().eq('user_id', user.id)
      }
      setMessages([])
      setProfile(null)
      setReady(false)
      setSeriesComplete(false)
      bootstrapAttempted.current = true
      await bootstrapChat(row.id)
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
    setStatus(null)
    try {
      const res = await invokeFunction<{
        reply: string
        profile: SearchProfileData | null
        ready?: boolean
        series_complete?: boolean
        filters?: unknown
        filters_updated?: boolean
        intent?: string
      }>('chat-profile', {
        action: finalize ? 'finalize' : 'reply',
        message: message || undefined,
        finalize,
      })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply }])
      if (res.profile) {
        const q = Number(res.profile.orientation_q ?? 0)
        setProfile({
          ...res.profile,
          orientation_q: Number.isFinite(q) ? q : res.profile.orientation_q,
        })
      }
      if (typeof res.series_complete === 'boolean') {
        setSeriesComplete(res.series_complete)
      }
      if (res.ready) {
        setReady(true)
        await orientation.advanceTo('filters')
        setStatus('Profile saved — review your filters next.')
        navigate('/app/filters')
      } else if (res.filters_updated) {
        setStatus('Search filters updated to match your profile.')
      } else if (res.intent === 'update_profile' && orientation.complete) {
        // After orientation, surface freeform profile edits. During the
        // interview every advance also returns update_profile — skip noise.
        setStatus('Profile updated.')
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Chat failed')
    } finally {
      setBusy(false)
    }
  }

  const lastAssistantText = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant')?.content
  const quickOptions = orientationQuickOptions(
    profile,
    seriesComplete,
    lastAssistantText,
  )
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
            Upload your resume and chat with FollowUp AI — it knows the app, can
            explain your search profile, and updates targets (and filters) when you
            ask to add or remove something.
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
            <span
              className="profile-resume-chip"
              title={searchProfiles.active?.name || fileName || ''}
            >
              {searchProfiles.active?.name || fileName}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setManagerOpen(true)}
            >
              Search profiles and resumes
            </button>
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
                  className={`profile-quick-btn${opt === 'Confirm' ? ' is-confirm' : ''}`}
                  disabled={busy || bootstrapping}
                  onClick={() =>
                    void send(
                      false,
                      opt === 'Confirm' ? CONFIRM_SUGGESTED_LIST : opt,
                    )
                  }
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
                  ? 'Ask about FollowUp, your profile, or what to change…'
                  : seriesComplete
                    ? 'Ask a question, or clarify anything else…'
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
      {managerOpen && (
        <SearchProfilesModal
          onClose={() => setManagerOpen(false)}
          onSwitched={() => {
            bootstrapAttempted.current = false
            void searchProfiles.refresh()
          }}
        />
      )}
    </div>
  )
}
