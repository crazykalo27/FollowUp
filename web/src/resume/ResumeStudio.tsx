import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { invokeFunction } from '../lib/api'
import { countCreatedOnUtcDay, creationGate } from './engine.ts'
import { ResumeVaultProvider, useVaultApi } from './context.tsx'
import { EditorPane } from './EditorPane.tsx'
import { LibraryPane } from './LibraryPane.tsx'
import { ResumesPane } from './ResumesPane.tsx'
import { TrackerPane } from './TrackerPane.tsx'
import { Modal } from './widgets.tsx'
import './resume.css'

type Pane = 'library' | 'resumes' | 'tracker'

export function ResumeStudio({
  userId,
  email,
  basePath,
}: {
  userId: string
  email: string
  basePath: string
}) {
  return (
    <ResumeVaultProvider userId={userId} email={email}>
      <StudioFrame basePath={basePath} />
    </ResumeVaultProvider>
  )
}

function StudioFrame({ basePath }: { basePath: string }) {
  const api = useVaultApi()
  const navigate = useNavigate()
  const params = useParams()
  const [search] = useSearchParams()
  const [planOpen, setPlanOpen] = useState(false)
  const [nameOpen, setNameOpen] = useState(() => {
    if (sessionStorage.getItem(`followup.resumeNameSkipped:${api.email}`)) return false
    return !api.vault.profile.firstName && !api.vault.profile.lastName
  })
  const resumeId = params.resumeId
  const pane: Pane = search.get('pane') === 'library' || search.get('pane') === 'tracker' ? search.get('pane') as Pane : 'resumes'
  const today = countCreatedOnUtcDay(api.vault.resumes.map((resume) => resume.createdAt))
  const gate = creationGate({
    plan: api.vault.billing.plan,
    resumeCredits: api.vault.billing.resumeCredits,
    resumesCreatedTodayUtc: today,
  })

  function openPane(next: Pane) {
    navigate(next === 'resumes' ? basePath : `${basePath}?pane=${next}`)
  }

  return (
    <div className="resume-studio">
      {!resumeId && (
        <header className="resume-top">
          <div>
            <h1>Resume</h1>
            <p className="lede">Library, tailored pages, and the roles you sent them to.</p>
          </div>
          <div className="resume-top-actions">
            <p className="muted small" role="status">
              {api.remote === 'checking' ? 'Checking saved resume…' : api.remote === 'synced' ? 'Synced to your account' : 'Saved on this device'}
              {' · '}
              {api.vault.billing.plan === 'pro' ? 'Pro' : 'Free'}
              {' · '}
              {today} created today
              {!gate.ok && ' · credit needed for another today'}
            </p>
            <button type="button" className="btn btn-sm" onClick={() => setPlanOpen(true)}>Plan</button>
          </div>
        </header>
      )}
      {!resumeId && (
        <div className="resume-tabs" role="tablist" aria-label="Resume sections">
          <button type="button" role="tab" aria-selected={pane === 'library'} className={pane === 'library' ? 'resume-tab on' : 'resume-tab'} onClick={() => openPane('library')}>Library</button>
          <button type="button" role="tab" aria-selected={pane === 'resumes'} className={pane === 'resumes' ? 'resume-tab on' : 'resume-tab'} onClick={() => openPane('resumes')}>Resumes</button>
          <button type="button" role="tab" aria-selected={pane === 'tracker'} className={pane === 'tracker' ? 'resume-tab on' : 'resume-tab'} onClick={() => openPane('tracker')}>Applications</button>
        </div>
      )}
      <div className="resume-stage">
        {resumeId ? (
          <EditorPane resumeId={resumeId} onBack={() => navigate(basePath)} />
        ) : pane === 'library' ? (
          <LibraryPane />
        ) : pane === 'tracker' ? (
          <TrackerPane />
        ) : (
          <ResumesPane onOpen={(id) => navigate(`${basePath}/${id}`)} />
        )}
      </div>
      {planOpen && <PlanDialog onClose={() => setPlanOpen(false)} />}
      {nameOpen && !resumeId && (
        <NameDialog
          onClose={() => {
            sessionStorage.setItem(`followup.resumeNameSkipped:${api.email}`, '1')
            setNameOpen(false)
          }}
          onSave={(firstName, lastName) => {
            api.setProfile({ firstName, lastName })
            setNameOpen(false)
          }}
        />
      )}
    </div>
  )
}

function NameDialog({ onClose, onSave }: { onClose: () => void; onSave: (first: string, last: string) => void }) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  return (
    <Modal title="Name on new resumes" onClose={onClose}>
      <p className="muted">Used when you add a header. You can skip and type it on the page.</p>
      <div className="resume-split">
        <label className="resume-field">First name<input value={first} onChange={(e) => setFirst(e.target.value)} /></label>
        <label className="resume-field">Last name<input value={last} onChange={(e) => setLast(e.target.value)} /></label>
      </div>
      <div className="resume-actions">
        <button type="button" className="btn" onClick={onClose}>Skip</button>
        <button type="button" className="btn primary" onClick={() => onSave(first.trim(), last.trim())} disabled={!first.trim()}>Save name</button>
      </div>
    </Modal>
  )
}

function PlanDialog({ onClose }: { onClose: () => void }) {
  const api = useVaultApi()
  const [qty, setQty] = useState(1)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const today = countCreatedOnUtcDay(api.vault.resumes.map((resume) => resume.createdAt))

  async function buy() {
    setBusy(true)
    setError(null)
    try {
      const result = await invokeFunction<{ url?: string }>('billing-checkout', { quantity: qty })
      if (!result.url) throw new Error('Checkout did not return a link.')
      window.location.href = result.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout is not available on this account yet.')
    } finally {
      setBusy(false)
    }
  }

  async function redeem() {
    if (!code.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await invokeFunction<{ plan?: string; resumeCredits?: number }>('billing-redeem-promo', { code: code.trim() })
      if (result.plan === 'pro') {
        api.setBilling({ plan: 'pro', resumeCredits: result.resumeCredits ?? api.vault.billing.resumeCredits })
        setMessage('Pro plan unlocked.')
      } else {
        setMessage('Code applied.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.')
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    setBusy(true)
    setError(null)
    try {
      await invokeFunction('billing-unsubscribe-pro', {})
      api.setBilling({ ...api.vault.billing, plan: 'free' })
      setMessage('Pro removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the plan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Plan" onClose={onClose}>
      <p>{api.email || 'Signed-in account'}</p>
      <p>
        {api.vault.billing.plan === 'pro' ? 'Pro — unlimited new resumes.' : 'Free — one new resume per UTC day, then a credit.'}
      </p>
      <p className="muted small">{today} created today · {api.vault.billing.resumeCredits} credits · $0.50 each</p>
      {message && <p className="flash" role="status">{message}</p>}
      {error && <p className="flash error" role="alert">{error}</p>}
      <label className="resume-field">
        Credits to buy (1–100)
        <input type="number" min={1} max={100} value={qty} onChange={(e) => setQty(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} />
      </label>
      <p className="muted small">${(qty * 0.5).toFixed(2)} via checkout when billing is connected.</p>
      <div className="resume-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void buy()}>{busy ? 'Working…' : 'Buy credits'}</button>
        {api.vault.billing.plan === 'pro' && (
          <button type="button" className="btn" disabled={busy} onClick={() => void unsubscribe()}>Remove Pro</button>
        )}
      </div>
      <label className="resume-field">
        Promo code
        <input value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button type="button" className="btn" disabled={busy || !code.trim()} onClick={() => void redeem()}>Apply code</button>
    </Modal>
  )
}
