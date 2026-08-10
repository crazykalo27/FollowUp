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
  depthSizeSummary,
  loadActiveApplicationExtract,
  loadActiveCompanyPeopleTarget,
  loadActiveJobPosting,
  loadActiveRunDepth,
  loadActiveRunId,
  loadActiveRunMode,
  loadActiveRunTargetCompany,
  saveActiveApplicationExtract,
  saveActiveCompanyPeopleTarget,
  saveActiveJobPosting,
  saveActiveRunDepth,
  saveActiveRunId,
  prefillSpecificCompanySearch,
  saveActiveRunMode,
  saveActiveRunTargetCompany,
  type ApplicationExtract,
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

/** User-facing copy during calibration (backend still logs “Kept N/M…”). */
function formatFoundContactsMessage(text: string): string {
  const kept = text.match(/Kept (\d+)\/\d+ new contact/i)
  if (kept) {
    const n = Number(kept[1])
    return n === 1 ? 'Found 1 contact' : `Found ${n} contacts`
  }
  return text
}

function CalibrationSearchReport({ summary }: { summary: SearchSummary }) {
  const n = summary.contacts_created
  return (
    <div className="search-report search-report-compact">
      <p>
        Found <strong>{n}</strong> contact{n === 1 ? '' : 's'} across{' '}
        {summary.companies_selected} companies
        {summary.contacts_skipped_duplicate != null &&
        summary.contacts_skipped_duplicate > 0
          ? ` (${summary.contacts_skipped_duplicate} skipped — already on file)`
          : ''}
        .
      </p>
      {summary.diagnosis && (
        <p className="flash error">{summary.diagnosis}</p>
      )}
      {summary.company_reports.length > 0 && (
        <ul className="report-list search-report-companies">
          {summary.company_reports.map((r, i) => (
            <li key={`${r.name}-${i}`}>
              <strong>{r.name}</strong>
              {r.outcome
                ? ` — ${formatFoundContactsMessage(r.outcome)}`
                : r.kept > 0
                  ? ` — Found ${r.kept} contact${r.kept === 1 ? '' : 's'}`
                  : ''}
            </li>
          ))}
        </ul>
      )}
      {summary.errors?.length > 0 && (
        <p className="small flash error">{summary.errors[0]}</p>
      )}
    </div>
  )
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
    application?: {
      job_title?: string
      job_description?: string
      projects?: string[]
      responsibilities?: string[]
    } | null
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
    people_search_titles?: string[]
    exclude_titles: string[]
    require_verified_email: boolean
    max_companies_per_run: number
    max_contacts_per_company: number
    note_apollo?: string
  }
}

function ModeIcon({ mode }: { mode: SearchMode }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 20,
    height: 20,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (mode === 'company') {
    return (
      <svg {...common}>
        <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
        <path d="M15 9h4a1 1 0 0 1 1 1v11" />
        <path d="M2 21h20" />
        <path d="M8 8h3M8 12h3M8 16h3" />
      </svg>
    )
  }
  if (mode === 'application') {
    return (
      <svg {...common}>
        <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" />
        <path d="M14 3v5h4" />
        <path d="M9 13h6M9 17h6" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
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
  const showFullSearchUi = orientation.complete
  const inOrientationFlow = !orientation.complete
  const isSecondCalibration = orientation.step === 'search2'
  const [searchMode, setSearchMode] = useState<SearchMode>('general')
  const [targetCompany, setTargetCompany] = useState('')
  const [jobPostingText, setJobPostingText] = useState('')
  const [applicationExtract, setApplicationExtract] =
    useState<ApplicationExtract | null>(null)
  const [extractingJob, setExtractingJob] = useState(false)
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

  /** After a calibration run finishes, block another run until they review contacts. */
  const orientationAwaitingReview =
    !orientation.complete &&
    (orientation.step === 'contacts' ||
      orientation.step === 'contacts2' ||
      orientation.step === 'refine' ||
      orientation.step === 'drafts' ||
      (orientPrompt && (summary?.contacts_created ?? 0) > 0))
  const orientationSearchLocked = orientationAwaitingReview && !searching

  useEffect(() => {
    setSearchMode(loadActiveRunMode())
    setTargetCompany(loadActiveRunTargetCompany())
    setCompanyPeopleTarget(loadActiveCompanyPeopleTarget())
    setJobPostingText(loadActiveJobPosting())
    setApplicationExtract(loadActiveApplicationExtract())
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

  async function extractJobPosting() {
    if (!jobPostingText.trim()) {
      setErrorMsg(
        'Paste the company name and full job description from the application first.',
      )
      return
    }
    setExtractingJob(true)
    setErrorMsg(null)
    try {
      const res = await invokeFunction<{
        parsed: ApplicationExtract
      }>('parse-job-posting', { text: jobPostingText })
      const parsed = res.parsed
      const next: ApplicationExtract = {
        company: parsed.company || '',
        job_title: parsed.job_title || '',
        job_description: parsed.job_description || '',
        location: parsed.location || '',
        projects: parsed.projects || [],
        responsibilities: parsed.responsibilities || [],
        search_titles: parsed.search_titles,
        search_keywords: parsed.search_keywords,
      }
      setApplicationExtract(next)
      saveActiveApplicationExtract(next)
      if (next.company) {
        setTargetCompany(next.company)
        saveActiveRunTargetCompany(next.company)
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Could not parse job posting')
    } finally {
      setExtractingJob(false)
    }
  }

  function patchApplicationExtract(
    patch: Partial<ApplicationExtract>,
  ): ApplicationExtract {
    const next: ApplicationExtract = {
      company: patch.company ?? applicationExtract?.company ?? targetCompany ?? '',
      job_title: patch.job_title ?? applicationExtract?.job_title ?? '',
      job_description:
        patch.job_description ?? applicationExtract?.job_description ?? '',
      location: patch.location ?? applicationExtract?.location ?? '',
      projects: patch.projects ?? applicationExtract?.projects ?? [],
      responsibilities:
        patch.responsibilities ?? applicationExtract?.responsibilities ?? [],
      search_titles: patch.search_titles ?? applicationExtract?.search_titles,
      search_keywords:
        patch.search_keywords ?? applicationExtract?.search_keywords,
    }
    setApplicationExtract(next)
    saveActiveApplicationExtract(next)
    return next
  }

  async function runSearch() {
    if (!user || searching) return
    if (orientationSearchLocked) {
      setErrorMsg('Review the contacts from this search before running another.')
      return
    }

    if (searchMode === 'company' && !targetCompany.trim()) {
      setErrorMsg('Enter a company name for a specific-company search.')
      return
    }
    if (searchMode === 'application') {
      if (!jobPostingText.trim() && !targetCompany.trim()) {
        setErrorMsg(
          'Paste the company and job description from the application.',
        )
        return
      }
      if (
        !targetCompany.trim() &&
        !(applicationExtract?.company || '').trim()
      ) {
        setErrorMsg(
          'Include the company name in the paste, or fill Company after Extract.',
        )
        return
      }
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
    const companyLabel =
      targetCompany.trim() ||
      applicationExtract?.company?.trim() ||
      ''
    setSearching(true)
    setSummary(null)
    setLive({
      progress: 1,
      stage: 'starting',
      message:
        searchMode === 'application'
          ? `Preparing application follow-up at ${companyLabel || 'employer'}…`
          : searchMode === 'company'
            ? `Preparing search at ${companyLabel}…`
            : inOrientationSearch
              ? isSecondCalibration
                ? 'Preparing refined calibration search (4 people)…'
                : 'Preparing calibration search (4 people)…'
              : `Preparing ${preset.label.toLowerCase()} search…`,
      detail:
        searchMode === 'application' || searchMode === 'company'
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
          searchMode === 'application'
            ? `Starting application search at ${companyLabel}…`
            : searchMode === 'company'
              ? `Starting search at ${companyLabel}…`
              : inOrientationSearch
                ? 'Starting calibration search…'
                : `Preparing ${preset.label.toLowerCase()} search…`,
        detail:
          searchMode === 'application' || searchMode === 'company'
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
      !inOrientationSearch &&
        (searchMode === 'company' || searchMode === 'application')
        ? companyLabel
        : null,
    )
    if (searchMode === 'application') {
      saveActiveJobPosting(jobPostingText)
      if (applicationExtract) saveActiveApplicationExtract(applicationExtract)
    }
    setActiveRunId(run.id)
    startPolling(run.id)

    // Fire-and-forget: search continues on the server if the user navigates away.
    // Polling (resumed on remount) owns UI completion — don't clear poll here.
    void invokeFunction<{ accepted?: boolean; run_id: string }>('run-search', {
      run_id: run.id,
      depth: runDepth,
      search_mode: inOrientationSearch ? 'general' : searchMode,
      ...(!inOrientationSearch && searchMode === 'company'
        ? {
            target_company: companyLabel,
            company_people_target: companyPeopleTarget,
          }
        : {}),
      ...(!inOrientationSearch && searchMode === 'application'
        ? {
            target_company: companyLabel,
            company_people_target: companyPeopleTarget,
            job_posting_text: jobPostingText.trim(),
            application: applicationExtract
              ? {
                  company: applicationExtract.company,
                  job_title: applicationExtract.job_title,
                  job_description: applicationExtract.job_description,
                  location: applicationExtract.location,
                  projects: applicationExtract.projects,
                  responsibilities: applicationExtract.responsibilities,
                  search_titles: applicationExtract.search_titles,
                  search_keywords: applicationExtract.search_keywords,
                }
              : undefined,
          }
        : {}),
    }).catch((e) => {
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
  const targetCompanyLabel =
    targetCompany.trim() || applicationExtract?.company?.trim() || ''
  const peopleWord = companyPeopleTarget === 1 ? 'person' : 'people'
  const runSummary =
    searchMode === 'general'
      ? `${selectedDepth.companies} companies · ${selectedDepth.estimatePeople} · ${selectedDepth.eta}`
      : searchMode === 'company'
        ? `${companyPeopleTarget} ${peopleWord} at ${targetCompanyLabel || 'your company'}`
        : `${companyPeopleTarget} ${peopleWord} related to ${
            applicationExtract?.job_title || 'this role'
          } at ${targetCompanyLabel || 'the employer'}`
  const runDisabled =
    searching ||
    extractingJob ||
    !stats.onboarding ||
    (searchMode === 'company' && !targetCompany.trim()) ||
    (searchMode === 'application' &&
      !jobPostingText.trim() &&
      !targetCompany.trim() &&
      !(applicationExtract?.company || '').trim())
  const showStuckCancel =
    Boolean(activeRunId) && !searching && live?.stage !== 'done'
  const showGoToContacts =
    showFullSearchUi &&
    !orientationSearchLocked &&
    (orientation.canAccess('contacts') || orientPrompt)

  return (
    <div className="panel search-page">
      <header className="search-page-header">
        <h1>{pageTitle}</h1>
        <p className="lede">
          {inOrientationSearch
            ? isSecondCalibration
              ? '4 more people, refined by your feedback. Keep or discard each one.'
              : '4 people in your stated industry. Keep or discard each one to teach FollowUp AI.'
            : orientation.complete
              ? 'Pick a flow, set the size, run. Searches keep going if you leave the page.'
              : 'Run a search to find companies and direct contacts, then review them.'}
        </p>
      </header>

      {!orientation.complete && !inOrientationSearch && (
        <div className="search-orient-coach">
          {orientationSearchLocked ? (
            <>
              <p>
                <strong>Next:</strong> review each contact from this search
                (keep or discard with a reason)
                {isSecondCalibration || orientation.step === 'contacts2'
                  ? ' — then pick someone from Kept to draft.'
                  : ' — then we run one more refined search.'}
              </p>
              <p className="muted small">
                Search unlocks after you finish reviewing.
              </p>
            </>
          ) : (
            <p>
              Press <strong>Run search</strong> when ready. Progress continues
              even if you leave.
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

      <section
        className={`search-run-card${inOrientationFlow ? ' search-calibration-card' : ''}`}
      >
        {showFullSearchUi ? (
          <>
        <div className="search-step">
          <div className="search-step-head">
            <span className="search-step-num">1</span>
            <h3>Flow</h3>
          </div>
          <div
            className="search-mode-grid"
            role="radiogroup"
            aria-label="Search type"
          >
            {SEARCH_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={searchMode === m.id}
                className={`search-mode-card ${searchMode === m.id ? 'selected' : ''}`}
                disabled={searching}
                onClick={() => {
                  setSearchMode(m.id)
                  saveActiveRunMode(m.id)
                }}
              >
                <span className="search-mode-icon">
                  <ModeIcon mode={m.id} />
                </span>
                <strong>{m.label}</strong>
                <span className="search-mode-purpose">{m.purpose}</span>
              </button>
            ))}
          </div>
          <p className="muted small search-mode-detail">
            {selectedModeMeta.detail}
          </p>
        </div>

        {searchMode === 'company' && (
          <div className="search-step">
            <div className="search-step-head">
              <span className="search-step-num">2</span>
              <label
                className="search-step-title"
                htmlFor="search-target-company-input"
              >
                Company
              </label>
            </div>
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

        {searchMode === 'application' && (
          <>
            <div className="search-step">
              <div className="search-step-head">
                <span className="search-step-num">2</span>
                <label
                  className="search-step-title"
                  htmlFor="search-job-posting"
                >
                  Paste the posting
                </label>
                <span className="muted small search-step-hint">
                  Company name + full job description
                </span>
              </div>
              <textarea
                id="search-job-posting"
                className="search-job-posting-input"
                rows={7}
                placeholder={`Example:\nCompany: Acme Robotics\nLocation: Austin, TX (Hybrid)\nRole: Embedded Software Engineer\n\nJoin the Perception team working on the Orion stack…\nResponsibilities:\n- Own firmware for sensor fusion\n- Partner with the Orion project leads…`}
                value={jobPostingText}
                disabled={searching || extractingJob}
                onChange={(e) => {
                  setJobPostingText(e.target.value)
                  saveActiveJobPosting(e.target.value)
                }}
              />
              <div className="search-step-actions">
                <button
                  type="button"
                  className="btn search-extract-btn"
                  disabled={searching || extractingJob || !jobPostingText.trim()}
                  onClick={() => void extractJobPosting()}
                >
                  {extractingJob ? 'Extracting…' : 'Extract details'}
                </button>
              </div>
            </div>
            <div className="search-step">
              <div className="search-step-head">
                <span className="search-step-num">3</span>
                <h3>Confirm details</h3>
                <span className="muted small search-step-hint">
                  Auto-filled by Extract — edit anything
                </span>
              </div>
              <div className="search-application-fields">
                <label>
                  Company
                  <input
                    type="text"
                    className="search-target-input"
                    value={
                      applicationExtract?.company ?? targetCompany
                    }
                    disabled={searching}
                    onChange={(e) => {
                      const company = e.target.value
                      setTargetCompany(company)
                      saveActiveRunTargetCompany(company)
                      patchApplicationExtract({ company })
                    }}
                    placeholder="Extracted or typed company"
                    autoComplete="organization"
                  />
                </label>
                <label>
                  Job title
                  <input
                    type="text"
                    className="search-target-input"
                    value={applicationExtract?.job_title || ''}
                    disabled={searching}
                    onChange={(e) =>
                      patchApplicationExtract({ job_title: e.target.value })
                    }
                    placeholder="e.g. Senior FPGA Engineer"
                  />
                </label>
                <label>
                  Location{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    (optional)
                  </span>
                  <input
                    type="text"
                    className="search-target-input"
                    value={applicationExtract?.location || ''}
                    disabled={searching}
                    onChange={(e) =>
                      patchApplicationExtract({ location: e.target.value })
                    }
                    placeholder="e.g. Seattle, WA or Remote"
                    autoComplete="address-level2"
                  />
                </label>
                <label className="search-application-summary">
                  Role summary{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    (first person — fills [job description] in drafts)
                  </span>
                  <textarea
                    rows={3}
                    className="search-job-posting-input"
                    value={applicationExtract?.job_description || ''}
                    disabled={searching}
                    onChange={(e) =>
                      patchApplicationExtract({
                        job_description: e.target.value,
                      })
                    }
                    placeholder="I applied for the … role at …"
                  />
                </label>
                {(applicationExtract?.projects?.length ||
                  applicationExtract?.responsibilities?.length) ? (
                  <p className="muted small">
                    {applicationExtract?.projects?.length
                      ? `Projects/teams: ${applicationExtract.projects.join(', ')}`
                      : null}
                    {applicationExtract?.projects?.length &&
                    applicationExtract?.responsibilities?.length
                      ? ' · '
                      : null}
                    {applicationExtract?.responsibilities?.length
                      ? `Focus: ${applicationExtract.responsibilities
                          .slice(0, 2)
                          .join('; ')}`
                      : null}
                  </p>
                ) : null}
              </div>
            </div>
          </>
        )}

        <div className="search-step">
          <div className="search-step-head">
            <span className="search-step-num">
              {searchMode === 'general'
                ? 2
                : searchMode === 'company'
                  ? 3
                  : 4}
            </span>
            <h3>
              {searchMode === 'general' ? 'Size' : 'How many people?'}
            </h3>
            {searchMode !== 'general' && (
              <span className="muted small search-step-hint">
                {searchMode === 'application'
                  ? 'Exact role first, then senior teammates · up to 3 retry rounds'
                  : 'New contacts only · stops after 3 empty rounds'}
              </span>
            )}
          </div>
          {searchMode === 'general' ? (
            <div className="depth-picker">
              <div
                className="depth-grid depth-grid-simple"
                role="radiogroup"
                aria-label="Search size"
              >
                {depthChoices.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={depth === d.id}
                    className={`depth-card depth-card-simple ${depth === d.id ? 'selected' : ''}`}
                    disabled={searching}
                    onClick={() => setDepth(d.id)}
                  >
                    <strong className="depth-card-title">{d.label}</strong>
                    <span className="depth-card-size muted small">
                      {depthSizeSummary(d)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
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
          )}
        </div>

        <div className="search-run-footer">
          <p className="muted small search-run-summary">{runSummary}</p>
          <button
            type="button"
            className="btn primary search-run-btn"
            disabled={runDisabled}
            onClick={runSearch}
          >
            {searching ? 'Search running…' : 'Run search'}
          </button>
        </div>
          </>
        ) : (
          <div className="search-calibration-center">
            {orientationSearchLocked ? (
              <>
                <p className="search-calibration-next">
                  <strong>Next:</strong> review every contact from this search
                  (keep or discard with feedback).
                  {isSecondCalibration || orientation.step === 'contacts2'
                    ? ' Then pick someone from Kept to draft.'
                    : ' That teaches FollowUp who you want.'}
                </p>
                <button
                  type="button"
                  className="btn primary search-calibration-run"
                  onClick={() => navigate('/app/contacts')}
                >
                  Review contacts
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn primary search-calibration-run"
                  disabled={
                    searching ||
                    !stats.onboarding ||
                    (searchMode === 'company' && !targetCompany.trim()) ||
                    (searchMode === 'application' &&
                      !jobPostingText.trim() &&
                      !targetCompany.trim() &&
                      !(applicationExtract?.company || '').trim())
                  }
                  onClick={runSearch}
                >
                  {searching
                    ? 'Search running…'
                    : isSecondCalibration
                      ? 'Run second calibration search'
                      : 'Run calibration search'}
                </button>
                <p className="search-calibration-disclaimer muted small">
                  Takes a minute or two — keeps running if you leave this page.
                </p>
              </>
            )}
          </div>
        )}
      </section>

      {(showCancel || showStuckCancel || showGoToContacts) && (
        <div className="search-actions-bar">
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
          {showStuckCancel && (
            <button
              type="button"
              className="btn ghost"
              disabled={cancelling}
              onClick={() => void cancelSearch()}
            >
              {cancelling ? 'Cancelling…' : 'Cancel stuck search'}
            </button>
          )}
          {showGoToContacts && (
            <button
              type="button"
              className="btn"
              onClick={() => navigate('/app/contacts')}
            >
              Go to contacts
            </button>
          )}
        </div>
      )}

      {orientPrompt && inOrientationFlow && !orientationSearchLocked && (
        <p className="flash orientation-coach orientation-coach-inline">
          {orientation.step === 'contacts2' ||
          (isSecondCalibration && orientationAwaitingReview)
            ? 'Contacts ready — review them on the Contacts page.'
            : 'Contacts ready — review them with keep/discard feedback.'}
        </p>
      )}

      {live && (searching || live.progress > 0) && (
        <div className="search-progress-card">
        <div className="search-progress" aria-live="polite">
          <div className="search-progress-head">
            <strong>Overall</strong>
            <span className="muted">{live.progress}%</span>
          </div>
          <p className="small search-progress-lead">
            {inOrientationFlow
              ? formatFoundContactsMessage(live.message)
              : live.message}
          </p>
          <div className="progress-track progress-track-overall">
            <div
              className={`progress-fill ${searching ? 'active' : ''}`}
              style={{ width: `${Math.max(live.progress, 2)}%` }}
            />
          </div>
          {live.companies_total > 0 && !inOrientationFlow && (
            <p className="muted small">
              Companies completed: {live.companies_done}/{live.companies_total}
            </p>
          )}
          {live.detail && !inOrientationFlow && (
            <p className="muted small">{live.detail}</p>
          )}

          {!inOrientationFlow && live.progress_meta.companies.length > 0 && (
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

          {!inOrientationFlow && live.progress_meta.log.length > 0 && (
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
          {!inOrientationFlow && (
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
          )}
        </div>
        </div>
      )}

      {errorMsg && <p className="flash error">{errorMsg}</p>}

      {summary && (
        <details className="search-report-details">
          <summary>Search report</summary>
          <div className="search-report-card">
        {showFullSearchUi ? (
        <div className="search-report">
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
            {(summary.how.search_mode === 'company' ||
              summary.how.search_mode === 'application') &&
              summary.how.target_company && (
                <p className="small">
                  <strong>Target employer:</strong> {summary.how.target_company}
                  {summary.how.application?.job_title
                    ? ` · ${summary.how.application.job_title}`
                    : ''}
                </p>
              )}
            {summary.how.search_mode === 'application' &&
              summary.how.application?.job_description && (
                <p className="small">
                  <strong>Job description:</strong>{' '}
                  {summary.how.application.job_description}
                </p>
              )}
            <ul className="report-list">
              <li>
                <strong>
                  {summary.how.search_mode === 'application'
                    ? 'Role titles'
                    : 'Target roles'}
                  :
                </strong>{' '}
                {summary.how.search_mode === 'application'
                  ? (
                      summary.how.people_search_titles ||
                      summary.how.include_titles ||
                      summary.how.profile_roles ||
                      []
                    ).join(', ') || '—'
                  : summary.how.profile_roles?.join(', ') || '—'}
              </li>
              {summary.how.search_mode !== 'application' &&
                summary.how.profile_industries &&
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
                <strong>
                  {summary.how.search_mode === 'application'
                    ? 'People queries'
                    : 'Job queries'}
                  :
                </strong>{' '}
                {(summary.how.job_queries ||
                  (summary.how.job_query ? [summary.how.job_query] : [])
                )
                  .map((q) => `“${q}”`)
                  .join(', ') || '—'}
              </li>
              {summary.how.search_mode !== 'application' && (
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
              )}
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
                      <td className="small">
                        {formatFoundContactsMessage(r.outcome)}
                      </td>
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
        ) : (
          <CalibrationSearchReport summary={summary} />
        )}
        </div>
        </details>
      )}
    </div>
  )
}
