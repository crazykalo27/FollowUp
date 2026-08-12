import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { emailSettingsFromFilters, withoutLegacyRunLimits } from '../lib/searchEmailSettings'
import { useOrientation } from '../lib/orientationContext'
import { DEFAULT_FILTERS, type SearchFiltersData, type SearchProfileData } from '../types/database'
import './filters.css'

const EMPTY_SEARCH_PROFILE: SearchProfileData = {
  roles: [],
  industries: [],
  company_types: [],
  outreach_targets: [],
  employment_types: [],
  remote_preference: '',
  company_size: '',
  skills: [],
  locations: [],
  seniority: '',
  must_haves: [],
  tone: '',
}

const EMPLOYMENT_OPTIONS = [
  { id: 'full-time', label: 'Full-time' },
  { id: 'part-time', label: 'Part-time' },
  { id: 'contract', label: 'Contract' },
  { id: 'internship', label: 'Internship' },
] as const

const REMOTE_OPTIONS = [
  { id: 'remote', label: 'Remote' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'in-person', label: 'In-person' },
  { id: 'no preference', label: 'Any' },
] as const

const SIZE_OPTIONS = [
  { id: 'large', label: 'Large' },
  { id: 'medium', label: 'Medium' },
  { id: 'small', label: 'Small' },
  { id: 'no preference', label: 'Any' },
] as const

const SENIORITY_OPTIONS = [
  { id: 'entry', label: 'Entry' },
  { id: 'mid', label: 'Mid' },
  { id: 'experienced', label: 'Experienced' },
] as const

function listToText(list: string[]) {
  return list.join('\n')
}

function textToList(text: string) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeEmployment(list: string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const s = raw.toLowerCase().trim()
    if (s.includes('full')) out.push('full-time')
    else if (s.includes('part')) out.push('part-time')
    else if (s.includes('intern')) out.push('internship')
    else if (s.includes('contract')) out.push('contract')
  }
  return Array.from(new Set(out))
}

function normalizeRemote(raw: string): string {
  const s = raw.toLowerCase().trim()
  if (!s) return ''
  if (s.includes('remote')) return 'remote'
  if (s.includes('hybrid')) return 'hybrid'
  if (
    s.includes('onsite') ||
    s.includes('on-site') ||
    s.includes('in-person') ||
    s.includes('in person')
  ) {
    return 'in-person'
  }
  if (s.includes('flex') || s.includes('no preference') || s === 'any') {
    return 'no preference'
  }
  return s
}

function normalizeSeniority(raw: string): string {
  const s = raw.toLowerCase().trim()
  if (!s) return ''
  if (s.includes('entry') || s.includes('junior')) return 'entry'
  if (s.includes('experienc') || s.includes('senior') || s.includes('lead')) {
    return 'experienced'
  }
  if (s.includes('mid')) return 'mid'
  return s
}

function parseCompanySizes(raw: string): string[] {
  const s = raw.toLowerCase().trim()
  if (!s) return []
  if (s.includes('no preference') || s === 'any') return ['no preference']
  const found: string[] = []
  if (/\blarge\b/.test(s) || /\bbig\b/.test(s)) found.push('large')
  if (/\bmedium\b/.test(s) || /\bmid[- ]?size/.test(s)) found.push('medium')
  if (/\bsmall\b/.test(s) || /\bstartup\b/.test(s)) found.push('small')
  return found
}

function serializeCompanySizes(sizes: string[]): string {
  if (sizes.length === 0) return ''
  if (sizes.includes('no preference')) return 'no preference'
  return sizes.join(', ')
}

function toggleInList(list: string[], id: string, exclusiveAny = false): string[] {
  if (exclusiveAny && id === 'no preference') {
    return list.includes('no preference') ? [] : ['no preference']
  }
  const withoutAny = list.filter((x) => x !== 'no preference')
  if (withoutAny.includes(id)) return withoutAny.filter((x) => x !== id)
  return [...withoutAny, id]
}

type PrefDocs = {
  likes_doc: string
  dislikes_doc: string
  ai_summary: string | null
  discard_reason_counts: Record<string, number>
}

export function FiltersPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const [filters, setFilters] = useState<SearchFiltersData>(DEFAULT_FILTERS)
  const [includeText, setIncludeText] = useState(listToText(DEFAULT_FILTERS.include_titles))
  const [excludeText, setExcludeText] = useState(listToText(DEFAULT_FILTERS.exclude_titles))
  const [locationsText, setLocationsText] = useState('')
  const [rolesText, setRolesText] = useState('')
  const [industriesText, setIndustriesText] = useState('')
  const [companyTypesText, setCompanyTypesText] = useState('')
  const [companySizes, setCompanySizes] = useState<string[]>([])
  const [employmentTypes, setEmploymentTypes] = useState<string[]>([])
  const [remotePreference, setRemotePreference] = useState('')
  const [seniority, setSeniority] = useState('')
  const [outreachText, setOutreachText] = useState('')
  const [notesText, setNotesText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [continuing, setContinuing] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [prefs, setPrefs] = useState<PrefDocs | null>(null)
  const inOrientation = !orientation.complete

  async function loadSearchTargets() {
    if (!user) return
    const { data } = await supabase
      .from('search_profiles')
      .select('profile')
      .eq('user_id', user.id)
      .maybeSingle()
    const p =
      (data?.profile as SearchProfileData | undefined) || EMPTY_SEARCH_PROFILE
    setRolesText(listToText(p.roles || []))
    setIndustriesText(listToText(p.industries || []))
    setCompanyTypesText(listToText(p.company_types || []))
    setCompanySizes(parseCompanySizes(p.company_size || ''))
    setEmploymentTypes(normalizeEmployment(p.employment_types || []))
    setRemotePreference(normalizeRemote(p.remote_preference || ''))
    setSeniority(normalizeSeniority(p.seniority || ''))
    setOutreachText(listToText(p.outreach_targets || []))
    setNotesText(p.notes || '')
    setLocationsText(listToText(p.locations || []))
  }

  async function loadFilters() {
    if (!user) return
    const { data } = await supabase
      .from('search_filters')
      .select('filters')
      .eq('user_id', user.id)
      .maybeSingle()
    if (data?.filters) {
      const f = withoutLegacyRunLimits(
        data.filters as Record<string, unknown>,
      )
      setFilters({ ...DEFAULT_FILTERS, ...f })
      setIncludeText(listToText(f.include_titles || DEFAULT_FILTERS.include_titles))
      setExcludeText(listToText(f.exclude_titles || DEFAULT_FILTERS.exclude_titles))
      if ((f.locations || []).length) {
        setLocationsText(listToText(f.locations || []))
      }
    }
  }

  async function loadPrefs() {
    if (!user) return
    const { data } = await supabase
      .from('preference_documents')
      .select('likes_doc, dislikes_doc, ai_summary, discard_reason_counts')
      .eq('user_id', user.id)
      .maybeSingle()
    if (data) {
      setPrefs({
        likes_doc: data.likes_doc || '',
        dislikes_doc: data.dislikes_doc || '',
        ai_summary: data.ai_summary,
        discard_reason_counts:
          (data.discard_reason_counts as Record<string, number>) || {},
      })
    }
  }

  useEffect(() => {
    void loadSearchTargets()
    void loadFilters()
    if (!orientation.complete) {
      void loadPrefs()
    }
  }, [user, orientation.complete])

  async function saveSearchTargets(): Promise<boolean> {
    if (!user) return false
    const roles = textToList(rolesText)
    if (roles.length === 0) {
      setStatus('Add at least one target job title under Company targets.')
      return false
    }
    setSavingTargets(true)
    setStatus(null)
    const { data: existing } = await supabase
      .from('search_profiles')
      .select('profile')
      .eq('user_id', user.id)
      .maybeSingle()
    const base = {
      ...EMPTY_SEARCH_PROFILE,
      ...(existing?.profile as SearchProfileData | undefined),
    }
    const next: SearchProfileData = {
      ...base,
      roles,
      industries: textToList(industriesText),
      company_types: textToList(companyTypesText),
      company_size: serializeCompanySizes(companySizes) || undefined,
      employment_types: employmentTypes,
      remote_preference: remotePreference || undefined,
      seniority: seniority || base.seniority || '',
      outreach_targets: textToList(outreachText),
      locations: textToList(locationsText),
      notes: notesText.trim() || undefined,
      roles_confirmed: true,
    }
    const { error } = await supabase.from('search_profiles').upsert(
      {
        user_id: user.id,
        profile: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) {
      setSavingTargets(false)
      setStatus(error.message)
      return false
    }
    try {
      const res = await invokeFunction<{
        filters: SearchFiltersData
        rationale?: string
      }>('recommend-filters', {})
      await loadFilters()
      setStatus(
        res.rationale
          ? `Targets saved. Contact filters synced: ${res.rationale}`
          : 'Targets saved — contact filters synced.',
      )
    } catch (e) {
      setStatus(
        e instanceof Error
          ? `Targets saved, but filter sync failed: ${e.message}`
          : 'Targets saved, but filter sync failed.',
      )
    }
    setSavingTargets(false)
    return true
  }

  async function persistFilters(
    next: SearchFiltersData,
    opts?: { message?: string },
  ) {
    if (!user) return false
    const { data: row } = await supabase
      .from('search_filters')
      .select('filters')
      .eq('user_id', user.id)
      .maybeSingle()
    const email = emailSettingsFromFilters(
      row?.filters as Record<string, unknown> | undefined,
    )
    const merged: SearchFiltersData = { ...next, ...email }
    const { error } = await supabase.from('search_filters').upsert(
      {
        user_id: user.id,
        filters: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    if (error) {
      setStatus(error.message)
      return false
    }
    setFilters(merged)
    if (opts?.message !== '') {
      setStatus(opts?.message ?? 'Settings saved.')
    }
    return true
  }

  function mergeFilters(patch: Partial<SearchFiltersData>): SearchFiltersData {
    return {
      ...filters,
      include_titles: textToList(includeText),
      exclude_titles: textToList(excludeText),
      locations: textToList(locationsText),
      ...patch,
    }
  }

  async function save() {
    if (!user) return
    setSaving(true)
    setStatus(null)
    const okTargets = await saveSearchTargets()
    if (!okTargets) {
      setSaving(false)
      return
    }
    const next = mergeFilters({})
    await persistFilters(next, {
      message: 'Filters updated and saved.',
    })
    setSaving(false)
  }

  async function continueOrientation() {
    setContinuing(true)
    setStatus(null)
    const ok = await saveSearchTargets()
    if (!ok) {
      setContinuing(false)
      return
    }
    await orientation.advanceTo('search')
    setContinuing(false)
    navigate('/app/search')
  }

  async function recommendFromAi() {
    setRecommending(true)
    setStatus(null)
    try {
      const res = await invokeFunction<{
        filters: SearchFiltersData
        rationale?: string
      }>('recommend-filters', {})
      await loadFilters()
      setStatus(
        res.rationale
          ? `AI updated filters: ${res.rationale}`
          : 'AI rewrote filters from your profile and preferences.',
      )
      await loadPrefs()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Recommend failed')
    } finally {
      setRecommending(false)
    }
  }

  return (
    <div className="panel filters-page">
      <header className="filters-page-header">
        <h1>Filters</h1>
        <p className="lede">
          {inOrientation
            ? 'Next we will search for 4 people to calibrate your profile. You can provide feedback for what to keep / discard.'
            : 'Company targets drive which employers we hunt. Contact targets narrow who qualifies at each company.'}
        </p>
      </header>

      <div className="filters-flow-rail" aria-label="Search flow">
        <div className="filters-flow-step active">
          <span className="filters-flow-num">01</span>
          <span>Find companies</span>
        </div>
        <span className="filters-flow-arrow" aria-hidden>
          →
        </span>
        <div className="filters-flow-step active">
          <span className="filters-flow-num">02</span>
          <span>Find people</span>
        </div>
      </div>

      <div className="filters-flow-grid">
        <section
          className="filters-flow-card companies"
          aria-labelledby="filters-companies"
        >
          <h2 id="filters-companies">Company targets</h2>
          <p className="filters-card-kicker">
            Jobs, industries, and locations — what we search the web for first.
          </p>
          <div className="form-grid">
            <label>
              Jobs wanted
              <textarea
                value={rolesText}
                onChange={(e) => setRolesText(e.target.value)}
                placeholder="e.g. Product designer, Account executive"
              />
            </label>
            <label>
              Industries
              <textarea
                value={industriesText}
                onChange={(e) => setIndustriesText(e.target.value)}
                placeholder="e.g. Healthcare SaaS, municipal parks"
              />
            </label>
            <label>
              Company types
              <textarea
                value={companyTypesText}
                onChange={(e) => setCompanyTypesText(e.target.value)}
                placeholder="Startups, nonprofits, agencies"
              />
            </label>
            <label>
              Locations
              <textarea
                rows={3}
                value={locationsText}
                onChange={(e) => setLocationsText(e.target.value)}
                placeholder="One per line"
              />
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                placeholder="Optional context"
              />
            </label>
          </div>
        </section>

        <section
          className="filters-flow-card people"
          aria-labelledby="filters-people"
        >
          <h2 id="filters-people">Contact targets</h2>
          <p className="filters-card-kicker">
            At each company, who to find and which titles count.
          </p>
          <label>
            People to find
            <textarea
              value={outreachText}
              onChange={(e) => setOutreachText(e.target.value)}
              placeholder="Hiring managers, team leads"
            />
          </label>
          <div className="form-grid">
            <label>
              Include title keywords
              <textarea
                rows={5}
                value={includeText}
                onChange={(e) => setIncludeText(e.target.value)}
              />
            </label>
            <label>
              Exclude title keywords
              <textarea
                rows={5}
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
              />
            </label>
          </div>
        </section>
      </div>

      <section className="filters-looking" aria-labelledby="filters-looking-title">
        <div className="filters-looking-head">
          <h2 id="filters-looking-title">Looking for</h2>
        </div>
        <div className="filters-pref-list">
          <div className="filters-pref-row">
            <span className="filters-pref-label">Role type</span>
            <div
              className="filters-pref-chips"
              role="group"
              aria-label="Employment type"
            >
              {EMPLOYMENT_OPTIONS.map((opt) => {
                const on = employmentTypes.includes(opt.id)
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`filters-pref-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setEmploymentTypes((prev) => toggleInList(prev, opt.id))
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="filters-pref-row">
            <span className="filters-pref-label">Workplace</span>
            <div
              className="filters-pref-chips"
              role="radiogroup"
              aria-label="Remote preference"
            >
              {REMOTE_OPTIONS.map((opt) => {
                const on = remotePreference === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`filters-pref-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setRemotePreference((prev) =>
                        prev === opt.id ? '' : opt.id,
                      )
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="filters-pref-row">
            <span className="filters-pref-label">Company</span>
            <div
              className="filters-pref-chips"
              role="group"
              aria-label="Company size"
            >
              {SIZE_OPTIONS.map((opt) => {
                const on = companySizes.includes(opt.id)
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`filters-pref-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setCompanySizes((prev) => toggleInList(prev, opt.id, true))
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="filters-pref-row">
            <span className="filters-pref-label">Level</span>
            <div
              className="filters-pref-chips"
              role="radiogroup"
              aria-label="Seniority"
            >
              {SENIORITY_OPTIONS.map((opt) => {
                const on = seniority === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`filters-pref-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() =>
                      setSeniority((prev) => (prev === opt.id ? '' : opt.id))
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="actions">
        {inOrientation ? (
          <button
            type="button"
            className="btn primary"
            disabled={continuing || savingTargets}
            onClick={() => void continueOrientation()}
          >
            {continuing ? 'Saving…' : 'Save and continue to search'}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={saving || savingTargets}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save filters'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={recommending}
              onClick={() => void recommendFromAi()}
            >
              {recommending ? 'Asking AI…' : 'Rewrite from profile + prefs'}
            </button>
          </>
        )}
      </div>
      {status && <p className="flash">{status}</p>}

      {inOrientation && (
        <section
          className="filters-learning"
          aria-labelledby="filters-learning-title"
        >
          <h2 id="filters-learning-title">What the AI is learning</h2>
          <p className="muted small filters-learning-lede">
            Your feedback on each contact teaches the AI how to find people you
            want.
          </p>
          {prefs?.ai_summary && (
            <div className="pref-summary">
              <h3>AI preference memo</h3>
              <p>{prefs.ai_summary}</p>
            </div>
          )}
          <div className="pref-grid">
            <div>
              <h3>Positive feedback</h3>
              <pre className="pref-log">
                {prefs?.likes_doc?.trim() ||
                  '(empty — keep contacts with feedback)'}
              </pre>
            </div>
            <div>
              <h3>Negative feedback</h3>
              <pre className="pref-log">
                {prefs?.dislikes_doc?.trim() ||
                  '(empty — discard contacts with reasons)'}
              </pre>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
