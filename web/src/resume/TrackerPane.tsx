import { useMemo, useState } from 'react'
import { invokeFunction } from '../lib/api'
import { newId, nowIso, parseJobPosting, type ApplicationStatus, type JobApplication } from './engine.ts'
import { useVaultApi } from './context.tsx'
import { Confirm } from './widgets.tsx'

const STATUSES: ApplicationStatus[] = ['applied', 'interview', 'denied', 'admitted']

type SortField = 'appliedDate' | 'lastFollowedUp' | 'company' | 'position' | 'resumeName' | 'status' | 'createdAt' | 'updatedAt'
type Range = 'all' | '7d' | '30d' | '90d' | '365d'

const STATUS_ORDER: Record<ApplicationStatus, number> = { applied: 0, interview: 1, admitted: 2, denied: 3 }

function within(iso: string | undefined, range: Range): boolean {
  if (range === 'all') return true
  if (!iso) return false
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365
  const then = Date.now() - days * 86_400_000
  return Date.parse(iso) >= then
}

export function TrackerPane() {
  const api = useVaultApi()
  const [draft, setDraft] = useState<JobApplication | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ApplicationStatus | 'all'>('all')
  const [range, setRange] = useState<Range>('all')
  const [sort, setSort] = useState<SortField>('appliedDate')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [posting, setPosting] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = api.vault.applications.filter((app) => {
      if (status !== 'all' && app.status !== status) return false
      if (!within(app.appliedDate, range)) return false
      if (!q) return true
      return [app.company, app.position, app.resumeName, app.notes, app.link].join(' ').toLowerCase().includes(q)
    })
    const value = (app: JobApplication): string | number => {
      if (sort === 'status') return STATUS_ORDER[app.status]
      if (sort === 'company') return app.company.toLowerCase()
      if (sort === 'position') return app.position.toLowerCase()
      if (sort === 'resumeName') return (app.resumeName ?? '').toLowerCase()
      if (sort === 'lastFollowedUp') return app.lastFollowedUp ?? ''
      if (sort === 'createdAt') return app.createdAt
      if (sort === 'updatedAt') return app.updatedAt
      return app.appliedDate
    }
    return [...filtered].sort((a, b) => {
      const left = value(a)
      const right = value(b)
      const emptyA = left === '' || left == null
      const emptyB = right === '' || right == null
      if (emptyA && emptyB) return 0
      if (emptyA) return 1
      if (emptyB) return -1
      const mul = dir === 'asc' ? 1 : -1
      if (left < right) return -1 * mul
      if (left > right) return 1 * mul
      return 0
    })
  }, [api.vault.applications, query, status, range, sort, dir])

  function startNew() {
    const ts = nowIso()
    setDraft({
      id: newId(),
      company: '',
      position: '',
      appliedDate: ts.slice(0, 10),
      status: 'applied',
      createdAt: ts,
      updatedAt: ts,
    })
    setError(null)
  }

  async function readPosting() {
    if (!posting.trim()) {
      setError('Paste a posting before reading it.')
      return
    }
    setReading(true)
    setError(null)
    try {
      let company = ''
      let position = ''
      let source = 'on-device reading'
      try {
        const remote = await invokeFunction<{ parsed?: { company?: string; job_title?: string } }>('parse-job-posting', { text: posting })
        if (remote.parsed?.company && remote.parsed.job_title) {
          company = remote.parsed.company
          position = remote.parsed.job_title
          source = 'FollowUp posting reader'
        }
      } catch {
        source = 'on-device reading'
      }
      if (!company || !position) {
        const local = parseJobPosting(posting)
        if (!local) throw new Error('Could not find a company and role. Add lines like Company: and Position:.')
        company = local.company
        position = local.position
      }
      setDraft((prev) => prev ? { ...prev, company, position, notes: prev.notes || posting.slice(0, 600) } : prev)
      setMessage(`Filled company and role from ${source}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that posting.')
    } finally {
      setReading(false)
    }
  }

  function save() {
    if (!draft) return
    if (!draft.company.trim() || !draft.position.trim()) {
      setError('Company and position are required.')
      return
    }
    const resume = api.vault.resumes.find((row) => row.id === draft.resumeId)
    api.saveApplication({ ...draft, resumeName: resume?.name }, !api.vault.applications.some((row) => row.id === draft.id))
    setDraft(null)
    setMessage('Application saved.')
    setError(null)
  }

  return (
    <div className="resume-pane">
      <div className="resume-pane-bar">
        <button type="button" className="btn primary" onClick={startNew}>Add application</button>
        <label className="resume-search">
          <span className="sr-only">Search applications</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, role, notes" />
        </label>
      </div>
      <div className="resume-pane-bar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus | 'all')}>
          <option value="all">All statuses</option>
          {STATUSES.map((row) => <option key={row} value={row}>{row}</option>)}
        </select>
        <select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value as Range)}>
          <option value="all">Any time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="365d">Last year</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortField)}>
          <option value="appliedDate">Applied date</option>
          <option value="lastFollowedUp">Last followed up</option>
          <option value="updatedAt">Recently updated</option>
          <option value="createdAt">Recently added</option>
          <option value="company">Company</option>
          <option value="position">Position</option>
          <option value="resumeName">Resume name</option>
          <option value="status">Status</option>
        </select>
        <button type="button" className="btn btn-sm" onClick={() => setDir((d) => d === 'asc' ? 'desc' : 'asc')}>{dir === 'asc' ? 'Ascending' : 'Descending'}</button>
      </div>
      {message && <p className="flash" role="status">{message}</p>}
      {error && <p className="flash error" role="alert">{error}</p>}
      {draft && (
        <form className="resume-form" onSubmit={(e) => { e.preventDefault(); save() }}>
          <div className="resume-split">
            <label className="resume-field">Company<input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} /></label>
            <label className="resume-field">Position<input value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} /></label>
          </div>
          <div className="resume-split">
            <label className="resume-field">Link<input value={draft.link ?? ''} onChange={(e) => setDraft({ ...draft, link: e.target.value })} /></label>
            <label className="resume-field">
              Resume
              <select value={draft.resumeId ?? ''} onChange={(e) => setDraft({ ...draft, resumeId: e.target.value || undefined })}>
                <option value="">None</option>
                {api.vault.resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}
              </select>
            </label>
          </div>
          <div className="resume-split">
            <label className="resume-field">Applied<input type="date" value={draft.appliedDate} onChange={(e) => setDraft({ ...draft, appliedDate: e.target.value })} /></label>
            <label className="resume-field">Followed up<input type="date" value={draft.lastFollowedUp ?? ''} onChange={(e) => setDraft({ ...draft, lastFollowedUp: e.target.value })} /></label>
            <label className="resume-field">
              Status
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as ApplicationStatus })}>
                {STATUSES.map((row) => <option key={row} value={row}>{row}</option>)}
              </select>
            </label>
          </div>
          <label className="resume-field">
            Notes or posting
            <textarea rows={4} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </label>
          <label className="resume-field">
            Read a posting into company and role
            <textarea rows={4} value={posting} onChange={(e) => setPosting(e.target.value)} placeholder="Company: Acme&#10;Position: Software Engineer" />
          </label>
          <div className="resume-actions">
            <button type="button" className="btn" onClick={() => void readPosting()} disabled={reading}>{reading ? 'Reading…' : 'Read posting'}</button>
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="submit" className="btn primary">Save application</button>
          </div>
        </form>
      )}
      {api.vault.applications.length === 0 ? (
        <div className="resume-empty">
          <h2>No applications yet</h2>
          <p>Track where you sent a resume, then sort by status or follow-up date.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="resume-empty">
          <h2>No applications in this view</h2>
          <p>Clear the search, status, or time range.</p>
        </div>
      ) : (
        <ul className="resume-cards">
          {rows.map((app) => (
            <li key={app.id}>
              <article className="resume-card resume-card-wide">
                <div>
                  <strong>{app.company}</strong>
                  <span className="muted small">{app.position}</span>
                  <span className="resume-pill">{app.status}</span>
                  <span className="muted small">
                    Applied {app.appliedDate || '—'}
                    {app.lastFollowedUp ? ` · Followed up ${app.lastFollowedUp}` : ''}
                    {app.resumeName ? ` · ${app.resumeName}` : ''}
                  </span>
                  {app.link && <a href={app.link} target="_blank" rel="noreferrer">Opening</a>}
                </div>
                <div className="resume-card-actions">
                  <button type="button" className="btn btn-sm" onClick={() => { setDraft(app); setError(null) }}>Edit</button>
                  <button type="button" className="btn btn-sm" onClick={() => setDeleteId(app.id)}>Delete</button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {deleteId && (
        <Confirm
          title="Delete application"
          body="This removes the tracker row only."
          confirmLabel="Delete"
          onClose={() => setDeleteId(null)}
          onConfirm={() => {
            api.deleteApplication(deleteId)
            setDeleteId(null)
            setMessage('Application deleted.')
          }}
        />
      )}
    </div>
  )
}
