import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import {
  DEFAULT_SEARCH_EMAIL_SETTINGS,
  loadSearchEmailSettings,
  saveSearchEmailSettings,
  type SearchEmailSettings,
} from '../lib/searchEmailSettings'
import type { SearchProfileData } from '../types/database'

const EMPLOYMENT_TYPE_OPTIONS = [
  'full-time',
  'part-time',
  'internship',
  'contract',
] as const

const REMOTE_OPTIONS = [
  { value: 'remote', label: 'Remote only' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
  { value: 'flexible', label: 'Flexible' },
] as const

const EMPTY_PROFILE: SearchProfileData = {
  roles: [],
  industries: [],
  employment_types: [],
  remote_preference: '',
  skills: [],
  locations: [],
  seniority: '',
  must_haves: [],
  tone: '',
}

export function SettingsPage() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const [gmailEmail, setGmailEmail] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [employmentTypes, setEmploymentTypes] = useState<string[]>([])
  const [remotePreference, setRemotePreference] = useState('')
  const [savingEmployment, setSavingEmployment] = useState(false)
  const [emailSettings, setEmailSettings] = useState<SearchEmailSettings>(
    DEFAULT_SEARCH_EMAIL_SETTINGS,
  )
  const [savingEmailSettings, setSavingEmailSettings] = useState(false)

  useEffect(() => {
    const g = params.get('gmail')
    if (g === 'connected') setMsg('Gmail connected.')
    if (g === 'error') {
      setMsg(`Gmail connect failed: ${params.get('reason') || 'unknown'}`)
    }
  }, [params])

  useEffect(() => {
    if (!user) return
    void (async () => {
      const [{ data: gmail }, { data: prof }, { data: sp }, emailPrefs] =
        await Promise.all([
        supabase
          .from('gmail_connection')
          .select('email')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select(
            'full_name, linkedin_url, github_url, portfolio_url, website_url, display_name',
          )
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('search_profiles')
          .select('profile')
          .eq('user_id', user.id)
          .maybeSingle(),
        loadSearchEmailSettings(supabase, user.id),
      ])
      if (gmail?.email) {
        setGmailEmail(gmail.email)
      } else {
        const { data: tokenRow } = await supabase
          .from('gmail_tokens')
          .select('email')
          .eq('user_id', user.id)
          .maybeSingle()
        setGmailEmail(tokenRow?.email || null)
      }
      if (prof) {
        setFullName(prof.full_name || prof.display_name || '')
        setLinkedinUrl(prof.linkedin_url || '')
        setGithubUrl(prof.github_url || '')
        setPortfolioUrl(prof.portfolio_url || '')
        setWebsiteUrl(prof.website_url || '')
      }
      const p = (sp?.profile as SearchProfileData | undefined) || EMPTY_PROFILE
      setEmploymentTypes(p.employment_types || [])
      setRemotePreference(p.remote_preference || '')
      setEmailSettings(emailPrefs)
    })()
  }, [user])

  async function saveEmailDiscoverySettings() {
    if (!user) return
    setSavingEmailSettings(true)
    setMsg(null)
    const { error } = await saveSearchEmailSettings(
      supabase,
      user.id,
      emailSettings,
    )
    setSavingEmailSettings(false)
    if (error) setMsg(error)
    else {
      const fresh = await loadSearchEmailSettings(supabase, user.id)
      setEmailSettings(fresh)
      setMsg('Email discovery settings saved — used on every search run.')
    }
  }

  async function saveEmploymentPrefs() {
    if (!user) return
    if (employmentTypes.length === 0) {
      setMsg('Select at least one employment type.')
      return
    }
    if (!remotePreference) {
      setMsg('Select a remote / location preference.')
      return
    }
    setSavingEmployment(true)
    setMsg(null)
    const { data: existing } = await supabase
      .from('search_profiles')
      .select('profile')
      .eq('user_id', user.id)
      .maybeSingle()
    const base = {
      ...EMPTY_PROFILE,
      ...(existing?.profile as SearchProfileData | undefined),
    }
    const next: SearchProfileData = {
      ...base,
      employment_types: employmentTypes,
      remote_preference: remotePreference,
    }
    const { error } = await supabase.from('search_profiles').upsert(
      {
        user_id: user.id,
        profile: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    setSavingEmployment(false)
    if (error) setMsg(error.message)
    else setMsg('Job search preferences saved — used in drafts and profile chat.')
  }

  async function saveSenderProfile() {
    if (!user) return
    const name = fullName.trim()
    if (name.length < 2) {
      setMsg('Full name is required for email signatures.')
      return
    }
    setSavingProfile(true)
    setMsg(null)
    const trim = (s: string) => s.trim() || null
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: name,
        display_name: name,
        linkedin_url: trim(linkedinUrl),
        github_url: trim(githubUrl),
        portfolio_url: trim(portfolioUrl),
        website_url: trim(websiteUrl),
        profile_setup_complete: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    setSavingProfile(false)
    if (error) setMsg(error.message)
    else setMsg('Sender profile saved — new drafts will use this info.')
  }

  async function connectGmail() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await invokeFunction<{ url: string }>('gmail-oauth')
      window.location.href = res.url
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not start Gmail OAuth')
      setBusy(false)
    }
  }

  async function disconnectGmail() {
    if (!user) return
    await supabase.from('gmail_tokens').delete().eq('user_id', user.id)
    setGmailEmail(null)
    setMsg('Gmail disconnected.')
  }

  return (
    <div className="panel">
      <h1>Settings</h1>
      <p className="lede">
        Email signature for drafts and Gmail to send with your resume attached.
        Jobs and industries live under Filters.
      </p>

      <div className="settings-block">
        <h2>Email signature</h2>
        <p className="muted small">
          Required for drafting. Optional links appear only if provided.
        </p>
        <label>
          Full name
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </label>
        <label>
          LinkedIn URL
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
          />
        </label>
        <label>
          GitHub URL
          <input
            type="url"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
          />
        </label>
        <label>
          Portfolio URL
          <input
            type="url"
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
          />
        </label>
        <label>
          Website
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={savingProfile}
          onClick={() => void saveSenderProfile()}
        >
          {savingProfile ? 'Saving…' : 'Save sender profile'}
        </button>
      </div>

      <div className="settings-block">
        <h2>What you’re looking for</h2>
        <p className="muted small">
          Used in outreach templates (<code>[employment_type]</code>,{' '}
          <code>[remote]</code>) and profile chat. Target job titles stay under{' '}
          <Link to="/app/filters">Filters</Link>.
        </p>
        <fieldset className="check-group">
          <legend className="small">Employment type</legend>
          {EMPLOYMENT_TYPE_OPTIONS.map((opt) => (
            <label key={opt} className="check">
              <input
                type="checkbox"
                checked={employmentTypes.includes(opt)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setEmploymentTypes((t) => [...t, opt])
                  } else {
                    setEmploymentTypes((t) => t.filter((x) => x !== opt))
                  }
                }}
              />
              {opt}
            </label>
          ))}
        </fieldset>
        <label>
          Remote / location preference
          <select
            value={remotePreference}
            onChange={(e) => setRemotePreference(e.target.value)}
          >
            <option value="">Select…</option>
            {REMOTE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={savingEmployment}
          onClick={() => void saveEmploymentPrefs()}
        >
          {savingEmployment ? 'Saving…' : 'Save job preferences'}
        </button>
      </div>

      <div className="settings-block">
        <h2>Email discovery (search)</h2>
        <p className="muted small">
          Controls how FollowUp finds and keeps contact emails during{' '}
          <Link to="/app">Overview</Link> searches. Saved to your account — reload
          safe.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.enable_hunter}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                enable_hunter: e.target.checked,
              }))
            }
          />
          Use Hunter.io for email lookup (uses monthly API credits)
        </label>
        <p className="muted small">
          When off or credits are exhausted, FollowUp uses the free OSINT pipeline
          (site crawl, email patterns, MX checks, optional OSINT worker).
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.require_verified_email}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                require_verified_email: e.target.checked,
              }))
            }
          />
          Require verified deliverable email
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.accept_accept_all}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                accept_accept_all: e.target.checked,
              }))
            }
          />
          Accept &quot;accept_all&quot; verification status
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={savingEmailSettings}
          onClick={() => void saveEmailDiscoverySettings()}
        >
          {savingEmailSettings ? 'Saving…' : 'Save email discovery settings'}
        </button>
      </div>

      <div className="settings-block">
        <h2>Gmail</h2>
        <p>
          {gmailEmail
            ? `Connected as ${gmailEmail}`
            : 'Not connected — required to send.'}
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={connectGmail}
          >
            {busy ? 'Redirecting…' : gmailEmail ? 'Reconnect Gmail' : 'Connect Gmail'}
          </button>
          {gmailEmail && (
            <button type="button" className="btn ghost" onClick={disconnectGmail}>
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div className="settings-block">
        <h2>Account</h2>
        <p className="muted">{user?.email}</p>
      </div>

      {msg && <p className="flash">{msg}</p>}
    </div>
  )
}
