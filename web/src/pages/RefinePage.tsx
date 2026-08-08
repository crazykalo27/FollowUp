import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useOrientation } from '../lib/orientationContext'
import './refine.css'

export function RefinePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const [steps, setSteps] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [{ data: pref }, { data: sp }] = await Promise.all([
        supabase
          .from('preference_documents')
          .select('last_refine_steps')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('search_profiles')
          .select('profile')
          .eq('user_id', user.id)
          .maybeSingle(),
      ])
      if (cancelled) return
      const loaded = (pref?.last_refine_steps as string[] | null) || []
      setSteps(loaded)
      const profile = (sp?.profile || {}) as { industries?: string[] }
      setIndustries(profile.industries || [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  async function continueToSecondSearch() {
    await orientation.advanceTo('search2')
    navigate('/app/search')
  }

  if (loading) {
    return <div className="page-center muted">Loading refine summary…</div>
  }

  return (
    <div className="panel refine-page">
      <header className="refine-header">
        <h1>Refining what you want</h1>
        <p className="lede">
          We treat your target niche like a hill to climb — each keep/discard is a
          step toward a better peak. It will never be perfect, so we keep a little
          randomness to discover new options.
        </p>
      </header>

      <section className="refine-steps-card" aria-label="Optimization steps">
        <h2>What we just did</h2>
        {steps.length === 0 ? (
          <p className="muted">
            Finish reviewing your calibration contacts first — then we will show
            how your targets moved.
          </p>
        ) : (
          <ol className="refine-steps">
            {steps.map((s, i) => (
              <li key={`${i}-${s.slice(0, 24)}`}>{s}</li>
            ))}
          </ol>
        )}
      </section>

      {industries.length > 0 && (
        <section className="refine-industries" aria-label="Updated industries">
          <h3>Current industry targets</h3>
          <ul>
            {industries.map((ind) => (
              <li key={ind}>{ind}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="refine-actions">
        <button
          type="button"
          className="btn primary"
          disabled={steps.length === 0}
          onClick={() => void continueToSecondSearch()}
        >
          Run second search with refined targets
        </button>
      </div>
    </div>
  )
}
