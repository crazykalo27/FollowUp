import { useEffect, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import {
  DEFAULT_SEARCH_EMAIL_SETTINGS,
  loadSearchEmailSettings,
  saveSearchEmailSettings,
  type SearchEmailSettings,
} from '../lib/searchEmailSettings'
import { EmailVerifyButton } from '../components/EmailVerifyButton'
import './settings.css'

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
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
  const [emailSettings, setEmailSettings] = useState<SearchEmailSettings>(
    DEFAULT_SEARCH_EMAIL_SETTINGS,
  )
  const [savingEmailSettings, setSavingEmailSettings] = useState(false)
  const [testVerifyEmail, setTestVerifyEmail] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

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
      const [{ data: gmail }, { data: prof }, emailPrefs] = await Promise.all([
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

  async function deleteProfile() {
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') {
      setMsg('Type DELETE to confirm.')
      return
    }
    setDeleting(true)
    setMsg(null)
    try {
      await invokeFunction('delete-account', {})
      setDeleteOpen(false)
      await signOut()
      navigate('/', { replace: true })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not delete profile')
      setDeleting(false)
    }
  }

  return (
    <div className="panel settings-page">
      <header className="settings-page-header">
        <h1>Settings</h1>
        <p className="lede">
          Email signature for drafts and Gmail to send with your resume attached.
          Search targets and preferences live under Filters.
        </p>
      </header>

      <div className="settings-stack">
      <section className="settings-card">
        <h2>Email signature</h2>
        <p className="settings-card-kicker">
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
      </section>

      <section className="settings-card">
        <h2>Email discovery (search)</h2>
        <p className="settings-card-kicker">
          Controls how FollowUp finds and keeps contact emails during{' '}
          <Link to="/app/search">Search</Link>. Web search + OSINT is the default.
          Apollo, Tomba, and Hunter are optional (off by default). Saved to your account.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.enable_apollo === true}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                enable_apollo: e.target.checked,
              }))
            }
          />
          Use Apollo.io for email lookup (uses API credits)
        </label>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          When enabled, Apollo runs first per contact; Tomba, Hunter, and OSINT are
          skipped if Apollo finds an email.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.enable_tomba === true}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                enable_tomba: e.target.checked,
              }))
            }
          />
          Use Tomba.io for email lookup (uses API credits)
        </label>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          When enabled, Tomba runs after Apollo (if Apollo is on) and before Hunter
          and OSINT. Domain search also finds up to 10 people per company.
          Requires both <code>TOMBA_API_KEY</code> and <code>TOMBA_SECRET</code>{' '}
          as Supabase Edge Function secrets.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.enable_hunter === true}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                enable_hunter: e.target.checked,
              }))
            }
          />
          Use Hunter.io for email lookup (uses monthly API credits)
        </label>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          When enabled, Hunter runs after Apollo/Tomba (if those are on) and before
          OSINT. Domain search also finds up to 10 people per company when enabled.
        </p>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          When these are off or credits are exhausted, FollowUp uses the free OSINT
          pipeline (site crawl, email patterns, MX checks, optional OSINT worker).
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.enable_smtp_verify === true}
            onChange={(e) =>
              setEmailSettings((s) => ({
                ...s,
                enable_smtp_verify: e.target.checked,
              }))
            }
          />
          SMTP mailbox probe for deliverability checks (requires OSINT worker)
        </label>
        <p className="muted small" style={{ marginTop: '0.5rem' }}>
          When enabled, &quot;Check deliverability&quot; runs an SMTP RCPT handshake
          (no message body is sent). Connect Gmail below to use your address as the
          probe sender — still no email to the recipient.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={emailSettings.require_verified_email === true}
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
            checked={emailSettings.accept_accept_all !== false}
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
      </section>

      <section className="settings-card">
        <h2>Test deliverability</h2>
        <p className="settings-card-kicker">
          Check any address with MX (always) and optional SMTP RCPT when the worker
          is configured. No message is sent. With Gmail connected, the probe uses
          your address as the sender — post-send bounce detection still requires an
          actual outreach send.
        </p>
        <label>
          Email to check
          <input
            type="email"
            value={testVerifyEmail}
            placeholder="name@company.com"
            onChange={(e) => setTestVerifyEmail(e.target.value.trim())}
          />
        </label>
        {testVerifyEmail.includes('@') && (
          <EmailVerifyButton email={testVerifyEmail} />
        )}
      </section>

      <section className="settings-card">
        <h2>Gmail</h2>
        <p className="settings-card-kicker">
          Connect the account you send outreach from. Deliverability checks use
          your Gmail address as the SMTP probe sender when connected (no email
          sent to the recipient). After a real send, we scan the thread for bounces.
        </p>
        <p
          className={`settings-gmail-status ${gmailEmail ? 'connected' : ''}`}
        >
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
      </section>

      <section className="settings-card danger-zone">
        <h2>Account</h2>
        <p className="settings-account-email">{user?.email}</p>
        <p className="settings-card-kicker">
          Delete your profile to wipe resumes, contacts, drafts, filters, and
          chat. Signing in again starts orientation from the beginning. Your
          login account stays so you can return.
        </p>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            setDeleteConfirmText('')
            setDeleteOpen(true)
          }}
        >
          Delete profile
        </button>
      </section>
      </div>

      {deleteOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !deleting && setDeleteOpen(false)}
        >
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-profile-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-profile-title">Delete your profile?</h2>
            <p>
              This permanently deletes your FollowUp data (resume, profile chat,
              filters, contacts, drafts, Gmail connection). You will go through
              orientation again next time you sign in.
            </p>
            <label>
              Type <strong>DELETE</strong> to confirm
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                autoComplete="off"
                disabled={deleting}
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                disabled={deleting}
                onClick={() => setDeleteOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={
                  deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'
                }
                onClick={() => void deleteProfile()}
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <p className="flash">{msg}</p>}
    </div>
  )
}
