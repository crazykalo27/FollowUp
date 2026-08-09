import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

const DEFAULT_FULL_NAME = 'John Doe'

export function WelcomeSetupPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState(DEFAULT_FULL_NAME)
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, linkedin_url, profile_setup_complete')
        .eq('id', user.id)
        .maybeSingle()
      if (data?.profile_setup_complete && data.full_name) {
        navigate('/app/onboarding', { replace: true })
        return
      }
      if (data?.full_name) setFullName(data.full_name)
      if (data?.linkedin_url) setLinkedinUrl(data.linkedin_url)
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
    const payload = {
      full_name: name,
      display_name: name,
      linkedin_url: trim(linkedinUrl),
      profile_setup_complete: true,
      orientation_step: 'profile',
      orientation_complete: false,
      updated_at: new Date().toISOString(),
    }
    let { error: upErr } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', user.id)
    // Orientation columns may not exist until migration is applied
    if (upErr && /orientation_/i.test(upErr.message)) {
      const retry = await supabase
        .from('profiles')
        .update({
          full_name: name,
          display_name: name,
          linkedin_url: trim(linkedinUrl),
          profile_setup_complete: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
      upErr = retry.error
    }
    setBusy(false)
    if (upErr) {
      setError(upErr.message)
      return
    }
    navigate('/app/onboarding', { replace: true })
  }

  return (
    <div className="page-center welcome-setup">
      <div className="panel welcome-panel">
        <h1>Welcome to FollowUp</h1>
        <p className="lede">
          We help you find direct contacts — not black-hole applications.
          Your full name signs every outreach email. Add your LinkedIn if you want
          it in signatures — other links can go in Settings later.
        </p>

        <label>
          Full name <span className="required">*</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={DEFAULT_FULL_NAME}
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
