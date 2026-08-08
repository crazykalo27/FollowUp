import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { emailSettingsFromFilters } from '../lib/searchEmailSettings'
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

function listToText(list: string[]) {
  return list.join('\n')
}

function textToList(text: string) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
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
  const [companySize, setCompanySize] = useState('')
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
    setCompanySize(p.company_size || '')
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
      const f = data.filters as SearchFiltersData
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
    void loadPrefs()
  }, [user])

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
      company_size: companySize.trim() || undefined,
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
    const next = mergeFilters({})
    await persistFilters(next, { message: '' })
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
            ? 'Review company targets and who we should contact. Continue when these look right — or update and save first.'
            : 'Company targets drive which employers we hunt. Contact targets narrow who qualifies at each company.'}
        </p>
      </header>

      <div className="filters-flow-rail" aria-label="Search flow">
        <div className="filters-flow-step active">
          <span className="filters-flow-num">01</span>
          <span>Find companies</span>
        </div>
        <span className="filters-flow-arrow" aria-hidden>→</span>
        <div className="filters-flow-step active">
          <span className="filters-flow-num">02</span>
          <span>Find people</span>
        </div>
      </div>

      <div className="filters-flow-grid">
        <section className="filters-flow-card companies" aria-labelledby="filters-companies">
          <h2 id="filters-companies">Company targets</h2>
          <p className="filters-card-kicker">
            Jobs, industries, company type and size, and locations — what we search the web for first.
          </p>
          <div className="form-grid">
            <label>
              Jobs wanted
              <textarea
                value={rolesText}
                onChange={(e) => setRolesText(e.target.value)}
                placeholder="Quantum software engineer"
              />
            </label>
            <label>
              Industries
              <textarea
                value={industriesText}
                onChange={(e) => setIndustriesText(e.target.value)}
                placeholder="Quantum computing"
              />
            </label>
            <label>
              Company types
              <textarea
                value={companyTypesText}
                onChange={(e) => setCompanyTypesText(e.target.value)}
                placeholder="Startups, national labs"
              />
            </label>
            <label>
              Company size
              <input
                type="text"
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                placeholder="large / medium / small"
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

        <section className="filters-flow-card people" aria-labelledby="filters-people">
          <h2 id="filters-people">Contact targets</h2>
          <p className="filters-card-kicker">
            At each company, who to find and which titles count — hiring managers, peers, and keyword rules.
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
          {!inOrientation && (
            <div className="filters-run-limits">
              <div className="form-row">
                <label>
                  Max companies / run
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={filters.max_companies_per_run}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        max_companies_per_run: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label>
                  Max contacts / company
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={filters.max_contacts_per_company}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        max_contacts_per_company: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="actions">
        {inOrientation ? (
          <>
            <button
              type="button"
              className="btn primary"
              disabled={continuing || savingTargets}
              onClick={() => void continueOrientation()}
            >
              {continuing ? 'Continuing…' : 'Continue'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving || savingTargets}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Update and save'}
            </button>
          </>
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

      <section className="filters-learning" aria-labelledby="filters-learning-title">
        <h2 id="filters-learning-title">What the AI is learning</h2>
        <p className="muted small filters-learning-lede">
          Keep and discard feedback on Contacts teaches which pick signals to repeat or avoid.
          Filter rewrites use this together with your profile chat.
        </p>
        {prefs?.ai_summary && (
          <div className="pref-summary">
            <h3>AI preference memo</h3>
            <p>{prefs.ai_summary}</p>
          </div>
        )}
        <div className="pref-grid">
          <div>
            <h3>Rewarded pick signals</h3>
            <pre className="pref-log">
              {prefs?.likes_doc?.trim() || '(empty — keep contacts with feedback)'}
            </pre>
          </div>
          <div>
            <h3>Rejected pick signals</h3>
            <pre className="pref-log">
              {prefs?.dislikes_doc?.trim() || '(empty — discard with reasons)'}
            </pre>
          </div>
        </div>
      </section>
    </div>
  )
}
