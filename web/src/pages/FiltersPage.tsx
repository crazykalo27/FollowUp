import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { DEFAULT_FILTERS, type SearchFiltersData, type SearchProfileData } from '../types/database'

const EMPTY_SEARCH_PROFILE: SearchProfileData = {
  roles: [],
  industries: [],
  company_types: [],
  outreach_targets: [],
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
  const [filters, setFilters] = useState<SearchFiltersData>(DEFAULT_FILTERS)
  const [includeText, setIncludeText] = useState(listToText(DEFAULT_FILTERS.include_titles))
  const [excludeText, setExcludeText] = useState(listToText(DEFAULT_FILTERS.exclude_titles))
  const [locationsText, setLocationsText] = useState('')
  const [rolesText, setRolesText] = useState('')
  const [industriesText, setIndustriesText] = useState('')
  const [companyTypesText, setCompanyTypesText] = useState('')
  const [outreachText, setOutreachText] = useState('')
  const [notesText, setNotesText] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingTargets, setSavingTargets] = useState(false)
  const [recommending, setRecommending] = useState(false)
  const [prefs, setPrefs] = useState<PrefDocs | null>(null)

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
    setOutreachText(listToText(p.outreach_targets || []))
    setNotesText(p.notes || '')
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
      setLocationsText(listToText(f.locations || []))
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

  async function saveSearchTargets() {
    if (!user) return
    const roles = textToList(rolesText)
    if (roles.length === 0) {
      setStatus('Add at least one target job title under Search targets.')
      return
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
      outreach_targets: textToList(outreachText),
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
      return
    }
    try {
      const res = await invokeFunction<{
        filters: SearchFiltersData
        rationale?: string
      }>('recommend-filters', {})
      const f = { ...DEFAULT_FILTERS, ...res.filters }
      setFilters(f)
      setIncludeText(listToText(f.include_titles || DEFAULT_FILTERS.include_titles))
      setExcludeText(listToText(f.exclude_titles || DEFAULT_FILTERS.exclude_titles))
      setLocationsText(listToText(f.locations || []))
      setStatus(
        res.rationale
          ? `Search targets saved. Contact filters synced: ${res.rationale}`
          : 'Search targets saved — contact filters synced from your profile.',
      )
    } catch (e) {
      setStatus(
        e instanceof Error
          ? `Targets saved, but filter sync failed: ${e.message}`
          : 'Targets saved, but filter sync failed.',
      )
    }
    setSavingTargets(false)
  }

  async function save() {
    if (!user) return
    setSaving(true)
    setStatus(null)
    const next: SearchFiltersData = {
      ...filters,
      include_titles: textToList(includeText),
      exclude_titles: textToList(excludeText),
      locations: textToList(locationsText),
    }
    const { error } = await supabase.from('search_filters').upsert(
      {
        user_id: user.id,
        filters: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
    setSaving(false)
    if (error) setStatus(error.message)
    else {
      setFilters(next)
      setStatus('Filters saved. Search will use these deterministically.')
    }
  }

  async function recommendFromAi() {
    setRecommending(true)
    setStatus(null)
    try {
      const res = await invokeFunction<{
        filters: SearchFiltersData
        rationale?: string
      }>('recommend-filters', {})
      const f = { ...DEFAULT_FILTERS, ...res.filters }
      setFilters(f)
      setIncludeText(listToText(f.include_titles || []))
      setExcludeText(listToText(f.exclude_titles || []))
      setLocationsText(listToText(f.locations || []))
      setStatus(
        res.rationale
          ? `AI updated filters: ${res.rationale}`
          : 'AI rewrote filters from your resume, chat, and keep/discard history.',
      )
      await loadPrefs()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Recommend failed')
    } finally {
      setRecommending(false)
    }
  }

  return (
    <div className="panel">
      <h1>Filters & search targets</h1>
      <p className="lede">
        Search targets define which companies and roles we hunt for. Contact
        filters narrow which people titles qualify. Both feed every search run.
      </p>

      <section className="settings-block">
        <h2>Search targets</h2>
        <p className="muted small">
          Same fields as on <Link to="/app/onboarding">Profile</Link> — edit here
          or keep chatting there. One line or comma per item.
        </p>
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
          People to find
          <textarea
            value={outreachText}
            onChange={(e) => setOutreachText(e.target.value)}
            placeholder="Hiring managers, team leads"
          />
        </label>
        <label>
          Notes
          <textarea
            rows={3}
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Optional context for search and drafts"
          />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={savingTargets}
          onClick={() => void saveSearchTargets()}
        >
          {savingTargets ? 'Saving…' : 'Save search targets'}
        </button>
      </section>

      <h2>Contact filters</h2>
      <p className="muted small">
        Refined as you keep/discard contacts. Edit anytime — search uses these
        rules deterministically for people at each company.
      </p>

      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={recommending}
          onClick={() => void recommendFromAi()}
        >
          {recommending ? 'Asking AI…' : 'Rewrite filters from profile + prefs'}
        </button>
      </div>

      <div className="form-grid">
        <label>
          Include title keywords
          <textarea
            rows={6}
            value={includeText}
            onChange={(e) => setIncludeText(e.target.value)}
          />
        </label>
        <label>
          Exclude title keywords
          <textarea
            rows={6}
            value={excludeText}
            onChange={(e) => setExcludeText(e.target.value)}
          />
        </label>
        <label>
          Preferred locations (optional)
          <textarea
            rows={3}
            value={locationsText}
            onChange={(e) => setLocationsText(e.target.value)}
            placeholder="One per line"
          />
        </label>
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
        <label className="check">
          <input
            type="checkbox"
            checked={filters.require_verified_email}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                require_verified_email: e.target.checked,
              }))
            }
          />
          Require Hunter-verified email
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={filters.accept_accept_all}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                accept_accept_all: e.target.checked,
              }))
            }
          />
          Accept &quot;accept_all&quot; verification status
        </label>
      </div>

      <div className="actions">
        <button type="button" className="btn primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save filters'}
        </button>
      </div>
      {status && <p className="flash">{status}</p>}

      <section className="pref-docs">
        <h2>What you’ve liked / discarded</h2>
        <p className="muted small">
          Living documents updated each time you keep or discard a contact.
          The AI uses these when rewriting filters.
        </p>
        {prefs?.ai_summary && (
          <div className="pref-summary">
            <h3>AI preference memo</h3>
            <p>{prefs.ai_summary}</p>
          </div>
        )}
        <div className="pref-grid">
          <div>
            <h3>Likes</h3>
            <pre className="pref-log">
              {prefs?.likes_doc?.trim() || '(empty — keep some contacts)'}
            </pre>
          </div>
          <div>
            <h3>Dislikes</h3>
            <pre className="pref-log">
              {prefs?.dislikes_doc?.trim() || '(empty — discard with reasons)'}
            </pre>
          </div>
        </div>
      </section>
    </div>
  )
}
