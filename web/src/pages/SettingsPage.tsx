import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'

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
      const [{ data: gmail }, { data: prof }] = await Promise.all([
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
    })()
  }, [user])

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
