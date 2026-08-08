import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import {
  SEARCH_MODES,
  USER_SEARCH_DEPTHS,
  COMPANY_PEOPLE_TARGETS,
  depthPreset,
  loadActiveCompanyPeopleTarget,
  loadActiveRunDepth,
  loadActiveRunId,
  loadActiveRunMode,
  loadActiveRunTargetCompany,
  saveActiveCompanyPeopleTarget,
  saveActiveRunDepth,
  saveActiveRunId,
  prefillSpecificCompanySearch,
  saveActiveRunMode,
  saveActiveRunTargetCompany,
  type CompanyPeopleTarget,
  type SearchDepth,
  type SearchMode,
} from '../lib/searchDepth'
import './search.css'

type ProgressLogEntry = { ts: string; text: string }

type CompanyProgressRow = {
  name: string
  status: 'pending' | 'active' | 'done' | 'skipped'
  step: string
  step_progress: number
}

type ProgressMeta = {
  companies: CompanyProgressRow[]
  log: ProgressLogEntry[]
}

function formatLogTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ''
  }
}

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
    search_mode?: string
    target_company?: string | null
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
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const orientation = useOrientation()
  const [stats, setStats] = useState({
    resumes: 0,
    contacts: 0,
    drafts: 0,
    emailsSent: 0,
    onboarding: false,
    gmail: false,
  })
  const [searching, setSearching] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [summary, setSummary] = useState<SearchSummary | null>(null)
  const [depth, setDepth] = useState<SearchDepth>('standard')
  const inOrientationSearch =
    !orientation.complete &&
    (orientation.step === 'search' || orientation.step === 'search2')
  const isSecondCalibration = orientation.step === 'search2'
  const [searchMode, setSearchMode] = useState<SearchMode>('general')
  const [targetCompany, setTargetCompany] = useState('')
  const [companyPeopleTarget, setCompanyPeopleTarget] =
    useState<CompanyPeopleTarget>(2)
  const [live, setLive] = useState<{
    progress: number
    stage: string
    message: string
    detail: string | null
    current_company: string | null
    companies_total: number
    companies_done: number
    progress_meta: ProgressMeta
  } | null>(null)
  const pollRef = useRef<number | null>(null)
  const pollRunIdRef = useRef<string | null>(null)
  const lastNudgeRef = useRef(0)
  const appliedRunRef = useRef<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [orientPrompt, setOrientPrompt] = useState(false)

  useEffect(() => {
    setSearchMode(loadActiveRunMode())
    setTargetCompany(loadActiveRunTargetCompany())
    setCompanyPeopleTarget(loadActiveCompanyPeopleTarget())
  }, [])

  useEffect(() => {
    const company = searchParams.get('company')?.trim()
    if (!company) return
    setSearchMode('company')
    setTargetCompany(company)
    prefillSpecificCompanySearch(company)
  }, [searchParams])

  useEffect(() => {
    if (inOrientationSearch) {
      setDepth('orientation')
      setSearchMode('general')
      saveActiveRunDepth('orientation')
      saveActiveRunMode('general')
    } else if (depth === 'orientation') {
      // Calibration is orientation-only — never leave it selected in the picker
      setDepth('standard')
      saveActiveRunDepth('standard')
    }
  }, [inOrientationSearch, depth])

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
    pollRunIdRef.current = null
    stopPoll()
    setErrorMsg(null)
    if (!orientation.complete && next.contacts_created > 0) {
      const nextStep =
        orientation.step === 'search2' || orientation.step === 'refine'
          ? 'contacts2'
          : 'contacts'
      void orientation.advanceTo(nextStep).then(() => setOrientPrompt(true))
    }
  }

  function dismissStuckRun() {
    stopPoll()
    saveActiveRunId(null)
    setActiveRunId(null)
    pollRunIdRef.current = null
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
          detail: 'Stopped from Search',
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
      progress_meta?: ProgressMeta | null
    },
  ) {
    if (pollRunIdRef.current !== runId) return

    if (data.status === 'running') {
      setErrorMsg(null)
    }

    const rawMeta = data.progress_meta
    const meta: ProgressMeta =
      rawMeta && typeof rawMeta === 'object' && Array.isArray((rawMeta as ProgressMeta).companies)
        ? {
            companies: (rawMeta as ProgressMeta).companies,
            log: Array.isArray((rawMeta as ProgressMeta).log)
              ? (rawMeta as ProgressMeta).log
              : [],
          }
        : { companies: [], log: [] }

    setLive({
      progress: data.progress ?? 0,
      stage: data.stage || 'running',
      message: data.message || 'Working…',
      detail: data.detail ?? null,
      current_company: data.current_company ?? null,
      companies_total: data.companies_total || 0,
      companies_done: data.companies_done || 0,
      progress_meta: meta,
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
    pollRunIdRef.current = runId
    stopPoll()
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase
        .from('search_runs')
        .select(
          'progress, stage, message, detail, current_company, companies_total, companies_done, status, summary, error, updated_at, progress_meta',
        )
        .eq('id', runId)
        .maybeSingle()
      if (data) {
        applyRunRow(runId, data)
        if (
          data.status === 'running' &&
          data.updated_at &&
          pollRunIdRef.current === runId
        ) {
          const age = Date.now() - new Date(data.updated_at).getTime()
          const sinceNudge = Date.now() - lastNudgeRef.current
          if (age > 90_000 && sinceNudge > 85_000) {
            lastNudgeRef.current = Date.now()
            void invokeFunction('run-search', {
              run_id: runId,
              continue_run: true,
              depth: loadActiveRunDepth(),
            }).catch(() => {
              // polling will retry nudge later
            })
          }
        }
      }
    }, 800)
  }

  useEffect(() => {
    if (!user) return
    ;(async () => {
      const [r, c, d, sent, p, g] = await Promise.all([
        supabase.from('resumes').select('id', { count: 'exact', head: true }),
        supabase.from('contacts').select('id', { count: 'exact', head: true }),
        supabase.from('outreach_drafts').select('id', { count: 'exact', head: true }),
        supabase
          .from('outreach_drafts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'sent'),
        supabase.from('profiles').select('onboarding_complete').eq('id', user.id).maybeSingle(),
        supabase.from('gmail_connection').select('email').eq('user_id', user.id).maybeSingle(),
      ])
      setStats({
        resumes: r.count || 0,
        contacts: c.count || 0,
        drafts: d.count || 0,
        emailsSent: sent.count || 0,
        onboarding: Boolean(p.data?.onboarding_complete),
        gmail: Boolean(g.data?.email),
      })

      // Resume in-flight (or just-finished) search when returning to this page
      const storedId = loadActiveRunId()
      let runQuery = supabase
        .from('search_runs')
        .select(
          'id, progress, stage, message, detail, current_company, companies_total, companies_done, status, summary, error, created_at, progress_meta',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      const { data: latest } = await runQuery.maybeSingle()
      const { data: byId } = storedId
        ? await supabase
            .from('search_runs')
            .select(
              'id, progress, stage, message, detail, current_company, companies_total, companies_done, status, summary, error, progress_meta',
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

    if (searchMode === 'company' && !targetCompany.trim()) {
      setErrorMsg('Enter a company name for a specific-company search.')
      return
    }

    setErrorMsg(null)

    const staleBefore = new Date(Date.now() - 18 * 60 * 1000).toISOString()
    await supabase
      .from('search_runs')
      .update({
        status: 'failed',
        stage: 'failed',
        message: 'Search timed out',
        error: 'Server time limit — start a new search.',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .eq('status', 'running')
      .lt('updated_at', staleBefore)

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

    const runDepth: SearchDepth = inOrientationSearch ? 'orientation' : depth
    const preset = depthPreset(runDepth)
    const companyLabel = targetCompany.trim()
    setSearching(true)
    setSummary(null)
    setLive({
      progress: 1,
      stage: 'starting',
      message:
        searchMode === 'company'
          ? `Preparing search at ${companyLabel}…`
          : inOrientationSearch
            ? isSecondCalibration
              ? 'Preparing refined calibration search (4 people)…'
              : 'Preparing calibration search (4 people)…'
            : `Preparing ${preset.label.toLowerCase()} search…`,
      detail:
        searchMode === 'company'
          ? `Goal: ${companyPeopleTarget} people at one employer · ${preset.eta}`
          : `${preset.companies} companies × ${preset.perCompany} · ${preset.estimatePeople} · ${preset.eta}`,
      current_company: null,
      companies_total: 0,
      companies_done: 0,
      progress_meta: { companies: [], log: [] },
    })

    const { data: run, error: runErr } = await supabase
      .from('search_runs')
      .insert({
        user_id: user.id,
        status: 'running',
        stage: 'starting',
        progress: 1,
        message:
          searchMode === 'company'
            ? `Starting search at ${companyLabel}…`
            : inOrientationSearch
              ? 'Starting calibration search…'
              : `Preparing ${preset.label.toLowerCase()} search…`,
        detail:
          searchMode === 'company'
            ? `${companyPeopleTarget} people target`
            : `${preset.companies} companies × ${preset.perCompany}`,
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
    saveActiveRunDepth(runDepth)
    saveActiveRunMode(inOrientationSearch ? 'general' : searchMode)
    saveActiveRunTargetCompany(
      !inOrientationSearch && searchMode === 'company' ? companyLabel : null,
    )
    setActiveRunId(run.id)
    startPolling(run.id)

    // Fire-and-forget: search continues on the server if the user navigates away.
    // Polling (resumed on remount) owns UI completion — don't clear poll here.
    void invokeFunction<{
      summary?: SearchSummary
      run_id: string
      accepted?: boolean
    }>('run-search', {
      run_id: run.id,
      depth: runDepth,
      search_mode: inOrientationSearch ? 'general' : searchMode,
      ...(!inOrientationSearch && searchMode === 'company'
        ? {
            target_company: companyLabel,
            company_people_target: companyPeopleTarget,
          }
        : {}),
    })
      .then((res) => {
        if (res.accepted) return
        if (res.summary) {
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
            progress_meta: live?.progress_meta ?? { companies: [], log: [] },
          })
        }
      })
      .catch((e) => {
        // Background run may still finish — polling owns success/failure.
        const msg = e instanceof Error ? e.message : 'Search failed'
        if (!msg.includes('time limit')) {
          setErrorMsg(msg)
        }
        setSearching(false)
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

  const selectedDepth = depthPreset(
    inOrientationSearch
      ? 'orientation'
      : depth === 'orientation'
        ? 'standard'
        : depth,
  )
  // Calibration depth is forced during orientation only — never shown as a choice
  const depthChoices = USER_SEARCH_DEPTHS
  const pageTitle = inOrientationSearch
    ? isSecondCalibration
      ? 'Second calibration search'
      : 'Calibration search'
    : 'Search'
  const selectedModeMeta =
    SEARCH_MODES.find((m) => m.id === searchMode) ?? SEARCH_MODES[0]

  return (
    <div className="panel search-page">
      <header className="search-page-header">
        <h1>{pageTitle}</h1>
        <p className="lede">
          {inOrientationSearch
            ? isSecondCalibration
              ? 'We updated your niches from your keep/discard feedback. This second search uses those refined targets — still about four people.'
              : 'We will find about four people in your stated niches. Keep or discard each one with a reason so we can climb toward what you actually want.'
            : searchMode === 'company'
              ? 'Name the employer you applied to (or want to reach). We find people there for a thoughtful follow-up — not a spray-and-pray blast.'
              : orientation.complete
                ? 'We find companies in your target industries, then people to contact directly — not job-board black holes. Search keeps running if you leave this page.'
                : 'Run a search to discover companies and direct contacts based on your profile and filters. When it finishes, review contacts next.'}
        </p>
      </header>

      <div className="search-flow-rail" aria-label="Search pipeline">
        {searchMode === 'general' ? (
          <>
            <div className="search-flow-step">
              <span className="search-flow-num">01</span>
              <span>Discover companies</span>
            </div>
            <span className="search-flow-arrow" aria-hidden>→</span>
            <div className="search-flow-step">
              <span className="search-flow-num">02</span>
              <span>Find people</span>
            </div>
          </>
        ) : (
          <>
            <div className="search-flow-step">
              <span className="search-flow-num">01</span>
              <span>Name your employer</span>
            </div>
            <span className="search-flow-arrow" aria-hidden>→</span>
            <div className="search-flow-step">
              <span className="search-flow-num">02</span>
              <span>Find people to follow up</span>
            </div>
          </>
        )}
      </div>

      {!orientation.complete && (
        <div className="search-orient-coach">
          {inOrientationSearch ? (
            <>
              <p>
                <strong>How we find your niche:</strong> resume → specific
                industries you confirm → a small 4-person search → your
                keep/discard feedback nudges the targets (with ~10% exploration)
                → a second search with the update.
              </p>
              <p>
                Press <strong>Run calibration search</strong> for about four
                people. Stay or leave — progress continues either way.
              </p>
            </>
          ) : (
            <p>
              Choose a search size below, then press <strong>Run search</strong>.
              Stay on this page or leave — progress continues either way.
            </p>
          )}
        </div>
      )}

      {orientation.complete && (
        <div className="search-stats-row">
          <div className="search-stat-chip">
            <strong>{stats.resumes}</strong>
            <span>Resumes</span>
          </div>
          <div className="search-stat-chip">
            <strong>{stats.contacts}</strong>
            <span>Contacts</span>
          </div>
          <div className="search-stat-chip">
            <strong>
              {stats.emailsSent}
              <span className="search-stat-ratio"> / {stats.drafts}</span>
            </strong>
            <span>Emails sent / drafts</span>
          </div>
        </div>
      )}

      <section className="search-run-card">
        {inOrientationSearch ? (
          <>
            <h3>Calibration batch</h3>
            <p className="muted small" style={{ marginBottom: '1rem' }}>
              Fixed size: <strong>4 companies × 1 person</strong> (~4 contacts).
              {isSecondCalibration
                ? ' Uses your gradient-updated industries and filters.'
                : ' After you review all four, we refine niches and run one more search.'}
            </p>
            <p className="small depth-summary">
              Selected: <strong>{selectedDepth.label}</strong> — ~
              {selectedDepth.webSearchCredits} web searches,{' '}
              {selectedDepth.estimatePeople}, {selectedDepth.eta}
            </p>
          </>
        ) : (
          <>
        <h3>What kind of search?</h3>
        <div
          className="search-mode-toggle"
          role="radiogroup"
          aria-label="Search type"
        >
          {SEARCH_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={searchMode === m.id}
              className={`search-mode-pill ${searchMode === m.id ? 'selected' : ''}`}
              disabled={searching}
              onClick={() => {
                setSearchMode(m.id)
                saveActiveRunMode(m.id)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small search-mode-explainer">
          <strong>{selectedModeMeta.purpose}</strong> — {selectedModeMeta.detail}
        </p>

        {searchMode === 'company' && (
          <div className="search-target-company">
            <label htmlFor="search-target-company-input">Company name</label>
            <input
              id="search-target-company-input"
              type="text"
              className="search-target-input"
              placeholder="e.g. Nvidia, Stripe, Mayo Clinic"
              value={targetCompany}
              disabled={searching}
              onChange={(e) => {
                setTargetCompany(e.target.value)
                saveActiveRunTargetCompany(e.target.value)
              }}
              autoComplete="organization"
            />
          </div>
        )}

        {searchMode === 'general' ? (
          <>
            <h3 className="search-credits-heading">Search size (credits)</h3>
            <p className="muted small" style={{ marginBottom: '1rem' }}>
              Low / medium / high sets how many companies we discover and how
              many people per company. Hunter applies only if enabled in
              Settings.
            </p>
            <div className="depth-picker">
              <div className="depth-grid">
                {depthChoices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={`depth-card ${depth === d.id ? 'selected' : ''}`}
                    disabled={searching}
                    onClick={() => setDepth(d.id)}
                  >
                    <strong>{d.label}</strong>
                    <span className="depth-eta">
                      ~{d.webSearchCredits} Bing/Serper searches
                    </span>
                    <span className="depth-est">
                      Hunter: ~{d.hunterDomainCalls} domain
                      {d.hunterMaxFindVerify > 0
                        ? ` · up to ${d.hunterMaxFindVerify} find/verify`
                        : ''}
                    </span>
                    <span className="muted small">
                      {d.estimatePeople} · {d.companies} companies ×{' '}
                      {d.perCompany} max
                    </span>
                    <span className="muted small">{d.blurb}</span>
                  </button>
                ))}
              </div>
              <p className="small depth-summary">
                Selected: <strong>{selectedDepth.label}</strong> — ~
                {selectedDepth.webSearchCredits} web searches,{' '}
                {selectedDepth.estimatePeople}, {selectedDepth.eta}
              </p>
            </div>
          </>
        ) : (
          <>
            <h3 className="search-credits-heading">How many people?</h3>
            <p className="muted small" style={{ marginBottom: '0.75rem' }}>
              We keep searching (broader queries each round) until we find this
              many <strong>new</strong> contacts (not already on file) or hit{' '}
              <strong>3 rounds in a row</strong> with no new person.
            </p>
            <div
              className="company-people-toggle"
              role="radiogroup"
              aria-label="Number of people to find"
            >
              {COMPANY_PEOPLE_TARGETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={companyPeopleTarget === n}
                  className={`company-people-pill ${companyPeopleTarget === n ? 'selected' : ''}`}
                  disabled={searching}
                  onClick={() => {
                    setCompanyPeopleTarget(n)
                    saveActiveCompanyPeopleTarget(n)
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="small depth-summary">
              Target: <strong>{companyPeopleTarget}</strong> people at{' '}
              {targetCompany.trim() || 'your company'}
            </p>
          </>
        )}
          </>
        )}
      </section>

      <div className="search-actions-bar">
        <button
          type="button"
          className="btn primary"
          disabled={
            searching ||
            !stats.onboarding ||
            (searchMode === 'company' && !targetCompany.trim())
          }
          onClick={runSearch}
        >
          {searching
            ? 'Search running…'
            : inOrientationSearch
              ? isSecondCalibration
                ? 'Run second calibration search'
                : 'Run calibration search'
              : searchMode === 'company'
                ? `Search at ${targetCompany.trim() || 'company'} (${companyPeopleTarget} people)`
                : `Run search (${selectedDepth.label.toLowerCase()})`}
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
        {(orientation.canAccess('contacts') || orientPrompt) && (
          <button
            type="button"
            className="btn"
            onClick={() => navigate('/app/contacts')}
          >
            Go to contacts
          </button>
        )}
      </div>

      {orientPrompt && (
        <div className="flash orientation-coach">
          {orientation.step === 'contacts2' || isSecondCalibration
            ? 'Second search found contacts. Keep someone worth emailing to continue to drafts.'
            : 'Calibration search found people. Review all of them — keep or discard each with a reason — so we can refine your niches.'}
          <div className="actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate('/app/contacts')}
            >
              Review contacts
            </button>
          </div>
        </div>
      )}

      {live && (searching || live.progress > 0) && (
        <div className="search-progress-card">
        <div className="search-progress" aria-live="polite">
          <div className="search-progress-head">
            <strong>Overall</strong>
            <span className="muted">{live.progress}%</span>
          </div>
          <p className="small search-progress-lead">{live.message}</p>
          <div className="progress-track progress-track-overall">
            <div
              className={`progress-fill ${searching ? 'active' : ''}`}
              style={{ width: `${Math.max(live.progress, 2)}%` }}
            />
          </div>
          {live.companies_total > 0 && (
            <p className="muted small">
              Companies completed: {live.companies_done}/{live.companies_total}
            </p>
          )}
          {live.detail && <p className="muted small">{live.detail}</p>}

          {live.progress_meta.companies.length > 0 && (
            <div className="company-progress-block">
              <h4 className="company-progress-title">Per company</h4>
              <ul className="company-progress-list">
                {live.progress_meta.companies.map((c) => (
                  <li
                    key={c.name}
                    className={`company-progress-row ${c.status}`}
                  >
                    <div className="company-progress-row-head">
                      <span className="company-progress-name">{c.name}</span>
                      <span className="muted small">
                        {c.status === 'done' || c.status === 'skipped'
                          ? c.step
                          : `${c.step_progress}%`}
                      </span>
                    </div>
                    <div className="progress-track progress-track-mini">
                      <div
                        className={`progress-fill ${c.status === 'active' && searching ? 'active' : ''}`}
                        style={{
                          width: `${Math.max(
                            c.status === 'pending' ? 4 : c.step_progress,
                            4,
                          )}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {live.progress_meta.log.length > 0 && (
            <div className="activity-log-block">
              <h4 className="company-progress-title">Live activity</h4>
              <ul className="activity-log">
                {live.progress_meta.log.map((entry, idx) => (
                  <li key={`${entry.ts}-${idx}`}>
                    <time className="muted">{formatLogTime(entry.ts)}</time>
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
            </div>
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
        </div>
      )}

      {errorMsg && <p className="flash error">{errorMsg}</p>}

      {summary && (
        <div className="search-report-card">
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
            {summary.how.search_mode === 'company' &&
              summary.how.target_company && (
                <p className="small">
                  <strong>Target employer:</strong> {summary.how.target_company}
                </p>
              )}
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
        </div>
      )}
    </div>
  )
}
