import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import {
  SEARCH_DEPTHS,
  depthPreset,
  loadActiveRunId,
  saveActiveRunId,
  type SearchDepth,
} from '../lib/searchDepth'

type SourceStats = {
  configured: boolean
  attempted: number
  people_found: number
  after_title_filter: number
  with_email: number
  contacts_kept: number
  errors: string[]
  note?: string | null
}

type CompanyReport = {
  name: string
  domain: string | null
  hiring_signal: string
  source: string
  by_provider?: { hunter: number; websearch: number; proxycurl: number }
  kept: number
  outcome: string
}

type SearchSummary = {
  jobs_scanned: number
  companies_discovered?: number
  companies_selected: number
  contacts_created: number
  contacts_skipped_duplicate?: number
  diagnosis: string | null
  errors: string[]
  company_reports: CompanyReport[]
  source_stats: {
    hunter: SourceStats
    osint: SourceStats
    websearch: SourceStats
    proxycurl: SourceStats
  }
  how: {
    method: string
    job_query?: string
    job_queries?: string[]
    company_queries?: string[]
    location: string | null
    sources: {
      web_company?: {
        used: boolean
        companies: number
        searches: number
        note: string | null
      }
      remotive: { used: boolean; jobs: number }
      adzuna: { used: boolean; jobs: number; note: string | null }
    }
    profile_roles: string[]
    profile_industries?: string[]
    profile_skills: string[]
    include_titles: string[]
    exclude_titles: string[]
    require_verified_email: boolean
    max_companies_per_run: number
    max_contacts_per_company: number
    note_apollo?: string
  }
}

function SourceCard({
  name,
  stats,
}: {
  name: string
  stats: SourceStats
}) {
  return (
    <div className={`source-card ${stats.configured ? '' : 'dim'}`}>
      <h4>{name}</h4>
      {!stats.configured ? (
        <p className="muted small">{stats.note || 'Not configured'}</p>
      ) : (
        <ul className="report-list">
          <li>
            Found <strong>{stats.people_found}</strong> people
          </li>
          <li>
            After title filter: <strong>{stats.after_title_filter}</strong>
          </li>
          <li>
            With email: <strong>{stats.with_email}</strong>
          </li>
          <li>
            Kept as contacts: <strong>{stats.contacts_kept}</strong>
          </li>
        </ul>
      )}
      {stats.errors?.length > 0 && (
        <p className="small flash error">{stats.errors[0]}</p>
      )}
    </div>
  )
}

export function OverviewPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState({
    resumes: 0,
    contacts: 0,
    drafts: 0,
    onboarding: false,
    gmail: false,
  })
  const [searching, setSearching] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [summary, setSummary] = useState<SearchSummary | null>(null)
  const [depth, setDepth] = useState<SearchDepth>('standard')
  const [live, setLive] = useState<{
    progress: number
    stage: string
    message: string
    detail: string | null
    current_company: string | null
    companies_total: number
    companies_done: number
  } | null>(null)
  const pollRef = useRef<number | null>(null)
  const appliedRunRef = useRef<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  function stopPoll() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function finishWithSummary(runId: string, next: SearchSummary) {
    if (appliedRunRef.current === runId) return
    appliedRunRef.current = runId
    setSummary(next)
    setStats((s) => ({
      ...s,
      contacts: s.contacts + next.contacts_created,
    }))
    setSearching(false)
    saveActiveRunId(null)
    setActiveRunId(null)
    stopPoll()
  }

  function dismissStuckRun() {
    stopPoll()
    saveActiveRunId(null)
    setActiveRunId(null)
    setSearching(false)
    setLive(null)
    setErrorMsg(null)
  }

  async function cancelSearch() {
    if (!user) return
    const runId = activeRunId || loadActiveRunId()
    setCancelling(true)
    if (runId) {
      const { error } = await supabase
        .from('search_runs')
        .update({
          status: 'cancelled',
          stage: 'cancelled',
          message: 'Search cancelled',
          detail: 'Stopped from Overview',
          error: 'Cancelled by user',
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId)
        .eq('user_id', user.id)
        .eq('status', 'running')
      if (error) {
        setErrorMsg(error.message)
        setCancelling(false)
        return
      }
    }
    dismissStuckRun()
    setErrorMsg('Search cancelled. You can start a new search.')
    setCancelling(false)
  }

  function applyRunRow(
    runId: string,
    data: {
      progress?: number | null
      stage?: string | null
      message?: string | null
      detail?: string | null
      current_company?: string | null
      companies_total?: number | null
      companies_done?: number | null
      status?: string | null
      summary?: unknown
      error?: string | null
    },
  ) {
    setLive({
      progress: data.progress ?? 0,
      stage: data.stage || 'running',
      message: data.message || 'Working…',
      detail: data.detail ?? null,
      current_company: data.current_company ?? null,
      companies_total: data.companies_total || 0,
      companies_done: data.companies_done || 0,
    })
    if (data.status === 'done' && data.summary) {
      finishWithSummary(runId, data.summary as SearchSummary)
      setLive((prev) =>
        prev
          ? {
              ...prev,
              progress: 100,
              stage: 'done',
              message:
                (data.summary as SearchSummary).contacts_created > 0
                  ? `Done — ${(data.summary as SearchSummary).contacts_created} contact(s)`
                  : 'Done — no contacts kept',
            }
          : prev,
      )
    }
    if (data.status === 'failed') {
      setErrorMsg(data.error || 'Search failed')
      setSearching(false)
      saveActiveRunId(null)
      setActiveRunId(null)
      stopPoll()
    }
    if (data.status === 'cancelled') {
      setErrorMsg(data.error || 'Search cancelled.')
      setSearching(false)
      saveActiveRunId(null)
      setActiveRunId(null)
      stopPoll()
      setLive((prev) =>
        prev
          ? {
              ...prev,
              stage: 'cancelled',
              message: data.message || 'Search cancelled',
            }
          : prev,
      )
    }
  }

  function startPolling(runId: string) {
    setActiveRunId(runId)
    stopPoll()
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from('search_runs')
        .select(
          'progress, stage, message, detail, current_company, companies_total, companies_done, status, summary, error',
        )
        .eq('id', runId)
        .maybeSingle()
      if (data) applyRunRow(runId, data)
    }, 800)
  }

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const [r, c, d, p, g] = await Promise.all([
        supabase.from('resumes').select('id', { count: 'exact', head: true }),
        supabase.from('contacts').select('id', { count: 'exact', head: true }),
        supabase.from('outreach_drafts').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('onboarding_complete').eq('id', user.id).maybeSingle(),
        supabase.from('gmail_connection').select('email').eq('user_id', user.id).maybeSingle(),
      ])
      setStats({
        resumes: r.count || 0,
        contacts: c.count || 0,
        drafts: d.count || 0,
        onboarding: Boolean(p.data?.onboarding_complete),
        gmail: Boolean(g.data?.email),
      })

      // Resume in-flight (or just-finished) search when returning to this page
      const storedId = loadActiveRunId()
      let runQuery = supabase
        .from('search_runs')
        .select(
          'id, progress, stage, message, detail, current_company, companies_total, companies_done, status, summary, error, created_at',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      const { data: latest } = await runQuery.maybeSingle()
      const { data: byId } = storedId
        ? await supabase
            .from('search_runs')
            .select(
              'id, progress, stage, message, detail, current_company, companies_total, companies_done, status, summary, error',
            )
            .eq('id', storedId)
            .maybeSingle()
        : { data: null }

      const active =
        byId?.status === 'running'
          ? byId
          : latest?.status === 'running'
            ? latest
            : null

      if (active) {
        saveActiveRunId(active.id)
        setActiveRunId(active.id)
        setSearching(true)
        applyRunRow(active.id, active)
        startPolling(active.id)
        return
      }

      // Show last completed report if present
      const finished = byId?.status === 'done' ? byId : latest?.status === 'done' ? latest : null
      if (finished?.summary) {
        applyRunRow(finished.id, finished)
        // Don't double-count contacts on page load for old runs
        appliedRunRef.current = finished.id
        setSummary(finished.summary as SearchSummary)
        setSearching(false)
        saveActiveRunId(null)
      }
    })()

    return () => stopPoll()
  }, [user])

  async function runSearch() {
    if (!user || searching) return

    // Don't start a second run if one is already going
    const { data: existing } = await supabase
      .from('search_runs')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'running')
      .limit(1)
      .maybeSingle()
    if (existing) {
      saveActiveRunId(existing.id)
      setActiveRunId(existing.id)
      setSearching(true)
      startPolling(existing.id)
      setErrorMsg('A search is already running — showing live progress.')
      return
    }

    const preset = depthPreset(depth)
    setSearching(true)
    setErrorMsg(null)
    setSummary(null)
    setLive({
      progress: 1,
      stage: 'starting',
      message: `Preparing ${preset.label.toLowerCase()} search…`,
      detail: `${preset.companies} companies × ${preset.perCompany} · ${preset.estimatePeople} · ${preset.eta}`,
      current_company: null,
      companies_total: 0,
      companies_done: 0,
    })

    const { data: run, error: runErr } = await supabase
      .from('search_runs')
      .insert({
        user_id: user.id,
        status: 'running',
        stage: 'starting',
        progress: 1,
        message: `Preparing ${preset.label.toLowerCase()} search…`,
        detail: `${preset.companies} companies × ${preset.perCompany}`,
      })
      .select('id')
      .single()

    if (runErr || !run) {
      setSearching(false)
      setLive(null)
      setErrorMsg(runErr?.message || 'Could not start search run')
      return
    }

    saveActiveRunId(run.id)
    setActiveRunId(run.id)
    startPolling(run.id)

    // Fire-and-forget: search continues on the server if the user navigates away.
    // Polling (resumed on remount) owns UI completion — don't clear poll here.
    void invokeFunction<{
      summary: SearchSummary
      run_id: string
    }>('run-search', { run_id: run.id, depth })
      .then((res) => {
        finishWithSummary(run.id, res.summary)
        setLive({
          progress: 100,
          stage: 'done',
          message:
            res.summary.contacts_created > 0
              ? `Done — ${res.summary.contacts_created} contact(s)`
              : 'Done — no contacts kept',
          detail: null,
          current_company: null,
          companies_total: res.summary.companies_selected,
          companies_done: res.summary.companies_selected,
        })
      })
      .catch((e) => {
        setErrorMsg(e instanceof Error ? e.message : 'Search failed')
        setSearching(false)
        // Server may still be running — keep activeRunId so user can cancel
      })
  }

  const showCancel =
    Boolean(activeRunId) &&
    searching &&
    live?.stage !== 'done' &&
    live?.stage !== 'cancelled'

  const stages = [
    { id: 'loading_profile', label: 'Profile' },
    { id: 'discovering_companies', label: 'Companies' },
    { id: 'fetching_jobs', label: 'Jobs+' },
    { id: 'companies_ready', label: 'Rank' },
    { id: 'searching_people', label: 'People' },
    { id: 'finishing', label: 'Report' },
    { id: 'done', label: 'Done' },
  ]

  function stageIndex(stage: string) {
    if (stage === 'starting') return 0
    if (stage === 'failed') return -1
    const i = stages.findIndex((s) => s.id === stage)
    return i >= 0 ? i : 0
  }

  const selectedDepth = depthPreset(depth)

  return (
    <div className="panel">
      <h1>Overview</h1>
      <p className="lede">
        Find people who hire—not black-hole application portals. Search keeps
        running if you leave this page; come back anytime to see progress.
      </p>

      <div className="stat-row">
        <div>
          <strong>{stats.resumes}</strong>
          <span>Resumes</span>
        </div>
        <div>
          <strong>{stats.contacts}</strong>
          <span>Contacts</span>
        </div>
        <div>
          <strong>{stats.drafts}</strong>
          <span>Drafts</span>
        </div>
      </div>

      <ul className="checklist">
        <li className={stats.resumes ? 'done' : ''}>
          <Link to="/app/onboarding">Upload resume & build profile</Link>
          {stats.onboarding ? ' — ready' : ''}
        </li>
        <li>
          <Link to="/app/filters">Tune manager title filters</Link>
        </li>
        <li className={stats.gmail ? 'done' : ''}>
          <Link to="/app/settings">Connect Gmail</Link>
          {stats.gmail ? ' — connected' : ''}
        </li>
      </ul>

      <div className="depth-picker">
        <h3>Search depth</h3>
        <p className="muted small">
          Estimates are ceilings — title filters and email verify usually keep
          fewer.
        </p>
        <div className="depth-grid">
          {SEARCH_DEPTHS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`depth-card ${depth === d.id ? 'selected' : ''}`}
              disabled={searching}
              onClick={() => setDepth(d.id)}
            >
              <strong>{d.label}</strong>
              <span className="depth-eta">{d.eta}</span>
              <span className="depth-est">{d.estimatePeople}</span>
              <span className="muted small">
                {d.companies} companies · {d.perCompany}/company
              </span>
              <span className="muted small">{d.blurb}</span>
            </button>
          ))}
        </div>
        <p className="small depth-summary">
          Selected: <strong>{selectedDepth.label}</strong> —{' '}
          {selectedDepth.estimatePeople}, {selectedDepth.eta}
        </p>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn primary"
          disabled={searching || !stats.onboarding}
          onClick={runSearch}
        >
          {searching ? 'Search running…' : `Run ${selectedDepth.label.toLowerCase()} search`}
        </button>
        {showCancel && (
          <button
            type="button"
            className="btn ghost"
            disabled={cancelling}
            onClick={() => void cancelSearch()}
          >
            {cancelling ? 'Cancelling…' : 'Cancel search'}
          </button>
        )}
        {activeRunId && !searching && live?.stage !== 'done' && (
          <button
            type="button"
            className="btn ghost"
            disabled={cancelling}
            onClick={() => void cancelSearch()}
          >
            {cancelling ? 'Cancelling…' : 'Cancel stuck search'}
          </button>
        )}
        <Link className="btn" to="/app/contacts">
          View contacts
        </Link>
      </div>

      {live && (searching || live.progress > 0) && (
        <div className="search-progress" aria-live="polite">
          <div className="search-progress-head">
            <strong>{live.message}</strong>
            <span className="muted">{live.progress}%</span>
          </div>
          <div className="progress-track">
            <div
              className={`progress-fill ${searching ? 'active' : ''}`}
              style={{ width: `${Math.max(live.progress, 2)}%` }}
            />
          </div>
          {live.detail && <p className="muted small">{live.detail}</p>}
          {live.current_company && (
            <p className="small">
              Current company: <strong>{live.current_company}</strong>
              {live.companies_total > 0
                ? ` (${live.companies_done}/${live.companies_total})`
                : ''}
            </p>
          )}
          {searching && (
            <p className="muted small">
              Safe to leave this page — progress continues in the background.
            </p>
          )}
          {showCancel && (
            <div className="actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn ghost"
                disabled={cancelling}
                onClick={() => void cancelSearch()}
              >
                {cancelling ? 'Cancelling…' : 'Cancel search'}
              </button>
            </div>
          )}
          <ol className="progress-steps">
            {stages.map((s, i) => {
              const cur = stageIndex(live.stage)
              const state =
                live.stage === 'failed'
                  ? 'pending'
                  : i < cur
                    ? 'done'
                    : i === cur
                      ? 'current'
                      : 'pending'
              return (
                <li key={s.id} className={state}>
                  {s.label}
                </li>
              )
            })}
          </ol>
        </div>
      )}

      {errorMsg && <p className="flash error">{errorMsg}</p>}

      {summary && (
        <div className="search-report">
          <h2>Last search report</h2>
          <p className="flash">
            {summary.companies_discovered != null
              ? `${summary.companies_discovered} industry companies`
              : 'Industry discovery'}{' '}
            · {summary.jobs_scanned} jobs → {summary.companies_selected}{' '}
            companies → <strong>{summary.contacts_created} contacts</strong>
            {summary.contacts_skipped_duplicate != null &&
              summary.contacts_skipped_duplicate > 0 && (
                <span className="muted">
                  {' '}
                  · {summary.contacts_skipped_duplicate} skipped (already on
                  file)
                </span>
              )}
          </p>

          {summary.diagnosis && (
            <p className="flash error">{summary.diagnosis}</p>
          )}

          <div className="report-block">
            <h3>Source effectiveness</h3>
            <div className="source-grid">
              <SourceCard name="Hunter" stats={summary.source_stats.hunter} />
              <SourceCard
                name="OSINT email"
                stats={
                  summary.source_stats.osint ?? {
                    configured: true,
                    attempted: 0,
                    people_found: 0,
                    after_title_filter: 0,
                    with_email: 0,
                    contacts_kept: 0,
                    errors: [],
                  }
                }
              />
              <SourceCard
                name="Web → LinkedIn"
                stats={summary.source_stats.websearch}
              />
              <SourceCard
                name="Proxycurl"
                stats={summary.source_stats.proxycurl}
              />
            </div>
            {summary.how.note_apollo && (
              <p className="muted small">{summary.how.note_apollo}</p>
            )}
          </div>

          <div className="report-block">
            <h3>How this works</h3>
            <p className="muted">{summary.how.method}</p>
            <ul className="report-list">
              <li>
                <strong>Target roles:</strong>{' '}
                {summary.how.profile_roles?.join(', ') || '—'}
              </li>
              {summary.how.profile_industries &&
                summary.how.profile_industries.length > 0 && (
                  <li>
                    <strong>Industries:</strong>{' '}
                    {summary.how.profile_industries.join(', ')}
                  </li>
                )}
              <li>
                <strong>Company queries:</strong>{' '}
                {(summary.how.company_queries || [])
                  .map((q) => `“${q}”`)
                  .join(', ') || '—'}
              </li>
              <li>
                <strong>Job queries:</strong>{' '}
                {(summary.how.job_queries ||
                  (summary.how.job_query ? [summary.how.job_query] : [])
                )
                  .map((q) => `“${q}”`)
                  .join(', ') || '—'}
              </li>
              <li>
                <strong>Web companies:</strong>{' '}
                {summary.how.sources.web_company?.used
                  ? summary.how.sources.web_company.companies
                  : summary.how.sources.web_company?.note || '—'}{' '}
                · <strong>Remotive:</strong>{' '}
                {summary.how.sources.remotive.jobs} jobs ·{' '}
                <strong>Adzuna:</strong>{' '}
                {summary.how.sources.adzuna.used
                  ? summary.how.sources.adzuna.jobs
                  : summary.how.sources.adzuna.note}
              </li>
              <li>
                <strong>Include titles:</strong>{' '}
                {summary.how.include_titles.join(', ') || '—'}
              </li>
            </ul>
          </div>

          <div className="report-block">
            <h3>Per company</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Domain</th>
                    <th>H / Web / P</th>
                    <th>Kept</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.company_reports.map((r, i) => (
                    <tr key={`${r.name}-${i}`}>
                      <td>
                        {r.name}
                        <div className="muted small">{r.hiring_signal}</div>
                      </td>
                      <td>{r.domain || '—'}</td>
                      <td className="small">
                        {r.by_provider
                          ? `${r.by_provider.hunter} / ${r.by_provider.websearch} / ${r.by_provider.proxycurl}`
                          : '—'}
                      </td>
                      <td>{r.kept}</td>
                      <td className="small">{r.outcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {summary.errors?.length > 0 && (
            <div className="report-block">
              <h3>Errors</h3>
              <ul className="report-list">
                {summary.errors.slice(0, 12).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
