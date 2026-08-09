import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useOrientation } from '../lib/orientationContext'
import './refine.css'

function refineLearnedSummary(steps: string[], industries: string[]): string {
  if (steps.length === 0 && industries.length === 0) return ''

  const bits: string[] = []

  if (industries.length > 0) {
    const list = industries.slice(0, 5).join(', ')
    bits.push(
      industries.length > 5
        ? `Industry focus: ${list}, and related niches.`
        : `Industry focus: ${list}.`,
    )
  }

  const cal = steps.find((s) => s.includes('keep /'))
  if (cal) {
    const m = cal.match(/(\d+) keep \/ (\d+) discard/)
    if (m) {
      const total = Number(m[1]) + Number(m[2])
      bits.push(
        `Your ${total} keep/discard choices (${m[1]} keep, ${m[2]} discard) shaped these targets.`,
      )
    }
  }

  const boosted = steps.find((s) => s.startsWith('Boosted'))
  if (boosted) {
    bits.push(
      boosted
        .replace(/^Boosted matches you liked: /, 'Leaning toward patterns you kept: ')
        .replace(/\.$/, '.'),
    )
  }

  const reduced = steps.find((s) => s.startsWith('Stepped away'))
  if (reduced) {
    bits.push(
      reduced
        .replace(/^Stepped away from misfits: /, 'Avoiding patterns you discarded: ')
        .replace(/\.$/, '.'),
    )
  }

  const titles = steps.find((s) => s.startsWith('Refined who'))
  if (titles) {
    bits.push(
      titles
        .replace(/^Refined who to contact: /, 'Prioritizing roles like ')
        .replace(/\.$/, '.'),
    )
  }

  if (bits.length === 1) {
    bits.push(
      'We keep a small exploration slice so the next search can still surface new options.',
    )
  }

  return bits.slice(0, 3).join(' ')
}

export function RefinePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const [steps, setSteps] = useState<string[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const learnedSummary = useMemo(
    () => refineLearnedSummary(steps, industries),
    [steps, industries],
  )

  const ready = steps.length > 0

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
          Your ratings updated your targets. Run a second search to see sharper
          matches.
        </p>
      </header>

      <div className="refine-flow-rail" aria-label="Orientation flow">
        <div className="refine-flow-step done">
          <span className="refine-flow-badge" aria-hidden>
            ✓
          </span>
          <span className="refine-flow-label">Rate contacts</span>
        </div>
        <span className="refine-flow-arrow" aria-hidden>
          →
        </span>
        <div className="refine-flow-step current">
          <span className="refine-flow-badge">02</span>
          <span className="refine-flow-label">Refine targets</span>
        </div>
        <span className="refine-flow-arrow" aria-hidden>
          →
        </span>
        <div className="refine-flow-step next">
          <span className="refine-flow-badge">03</span>
          <span className="refine-flow-label">Second search</span>
        </div>
      </div>

      <section
        className="refine-learned-box"
        aria-label="What we learned from your ratings"
      >
        <h2 className="refine-learned-title">What we learned</h2>
        {!ready ? (
          <p className="muted refine-learned-empty">
            Finish reviewing calibration contacts first — then this summary
            appears here.
          </p>
        ) : (
          <>
            <p className="refine-learned-text">{learnedSummary}</p>
            {industries.length > 0 && (
              <ul className="refine-industry-pills" aria-label="Industry targets">
                {industries.map((ind) => (
                  <li key={ind}>
                    <span className="pill">{ind}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="refine-actions">
        <button
          type="button"
          className="btn primary refine-cta"
          disabled={!ready}
          onClick={() => void continueToSecondSearch()}
        >
          Run second search
        </button>
      </div>
    </div>
  )
}
