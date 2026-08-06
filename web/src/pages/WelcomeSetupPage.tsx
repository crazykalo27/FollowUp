import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export function WelcomeSetupPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [githubUrl, setGithubUrl] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select(
          'full_name, linkedin_url, github_url, portfolio_url, website_url, profile_setup_complete',
        )
        .eq('id', user.id)
        .maybeSingle()
      if (data?.profile_setup_complete && data.full_name) {
        navigate('/app', { replace: true })
        return
      }
      if (data?.full_name) setFullName(data.full_name)
      if (data?.linkedin_url) setLinkedinUrl(data.linkedin_url)
      if (data?.github_url) setGithubUrl(data.github_url)
      if (data?.portfolio_url) setPortfolioUrl(data.portfolio_url)
      if (data?.website_url) setWebsiteUrl(data.website_url)
    })()
  }, [user, navigate])

  async function save() {
    if (!user) return
    const name = fullName.trim()
    if (name.length < 2) {
      setError('Enter your full name (used to sign outreach emails).')
      return
    }
    setBusy(true)
    setError(null)
    const trim = (s: string) => s.trim() || null
    const { error: upErr } = await supabase
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
    setBusy(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    navigate('/app', { replace: true })
  }

  return (
    <div className="page-center welcome-setup">
      <div className="panel welcome-panel">
        <h1>Welcome to FollowUp</h1>
        <p className="lede">
          Your full name goes in every outreach email signature. Add links only
          if you want them included — we never put placeholder text in drafts.
          You can change these anytime under Settings.
        </p>

        <label>
          Full name <span className="required">*</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Kallen Selby"
            autoComplete="name"
          />
        </label>

        <label>
          LinkedIn URL <span className="muted small">optional</span>
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="https://linkedin.com/in/…"
          />
        </label>

        <label>
          GitHub URL <span className="muted small">optional</span>
          <input
            type="url"
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
            placeholder="https://github.com/…"
          />
        </label>

        <label>
          Portfolio URL <span className="muted small">optional</span>
          <input
            type="url"
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>

        <label>
          Website <span className="muted small">optional</span>
          <input
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>

        {error && <p className="flash error">{error}</p>}

        <div className="actions">
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
