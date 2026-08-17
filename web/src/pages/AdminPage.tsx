import { useCallback, useEffect, useMemo, useState } from 'react'
import { invokeFunction } from '../lib/api'
import './settings.css'
import './search.css'
import './admin.css'

type Features = {
  hunter: boolean
  apollo: boolean
  tomba: boolean
  smtp: boolean
}

type AdminUserRow = {
  id: string
  email: string | null
  name: string | null
  created_at: string
  last_sign_in_at: string | null
  orientation_complete: boolean
  orientation_step: string | null
  resumes: number
  searches: number
  contacts: number
  kept: number
  discarded: number
  drafts: number
  sent: number
  bounced: number
  chat_messages: number
  gmail: boolean
  features: Features
}

type Overview = {
  ok: true
  totals: {
    users: number
    resumes: number
    searches: number
    contacts: number
    kept: number
    discarded: number
    drafts: number
    sent: number
    bounced: number
    gmail_connected: number
    hunter: number
    apollo: number
    tomba: number
    smtp: number
  }
  funnel: {
    signed_up: number
    orientation_complete: number
    has_resume: number
    ran_search: number
    kept_contact: number
    drafted: number
    sent: number
  }
  users: AdminUserRow[]
}

type ChatMsg = { role: string; content: string; created_at: string }
type SearchRun = {
  id: string
  status: string
  stage: string | null
  message: string | null
  created_at: string
}

type UserDetail = {
  ok: true
  user: {
    id: string
    email: string | null
    name: string | null
    orientation_complete: boolean
    orientation_step: string | null
    features: Features
  }
  search_profile: {
    roles?: string[]
    industries?: string[]
    outreach_targets?: string[]
    locations?: string[]
    seniority?: string
  } | null
  search_profile_name?: string | null
  chat_summary: string | null
  chat: ChatMsg[]
  searches: SearchRun[]
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function pct(part: number, whole: number) {
  if (!whole) return '0%'
  return `${Math.round((part / whole) * 100)}%`
}

function featurePills(f: Features) {
  const bits = [
    f.tomba && 'Tomba',
    f.hunter && 'Hunter',
    f.apollo && 'Apollo',
    f.smtp && 'SMTP',
  ].filter(Boolean) as string[]
  return bits.length ? bits.join(' · ') : 'OSINT only'
}

export function AdminPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invokeFunction<Overview>('admin-crm', {
        view: 'overview',
      })
      setData(res)
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Could not load admin stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openUser = async (id: string) => {
    setOpenId(id)
    setDetail(null)
    setDetailErr(null)
    setDetailLoading(true)
    try {
      const res = await invokeFunction<UserDetail>('admin-crm', {
        view: 'user',
        user_id: id,
      })
      setDetail(res)
    } catch (e) {
      setDetailErr(e instanceof Error ? e.message : 'Could not load user')
    } finally {
      setDetailLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const rows = data?.users || []
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((u) => {
      const blob = `${u.name || ''} ${u.email || ''} ${u.orientation_step || ''}`
      return blob.toLowerCase().includes(needle)
    })
  }, [data, q])

  if (loading) return <div className="page-center muted">Loading admin…</div>

  if (error || !data) {
    return (
      <div className="admin-page">
        <header className="admin-page-header">
          <h1>Admin</h1>
        </header>
        <p className="flash error">{error || 'No data'}</p>
        <p className="muted small">
          This page is only for operators. Set the{' '}
          <code>ADMIN_EMAILS</code> Edge Function secret to your Google login
          email (comma-separated if several), then redeploy{' '}
          <code>admin-crm</code>.
        </p>
      </div>
    )
  }

  const t = data.totals
  const f = data.funnel

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <h1>Admin</h1>
        <p className="lede">
          Usage across accounts — who signed up, what they used, and how far
          they got. Not visible to other users.
        </p>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          Refresh
        </button>
      </header>

      <div className="search-stats-row">
        <div className="search-stat-chip">
          <strong>{t.users}</strong>
          <span>Users</span>
        </div>
        <div className="search-stat-chip">
          <strong>{t.resumes}</strong>
          <span>Resumes</span>
        </div>
        <div className="search-stat-chip">
          <strong>{t.searches}</strong>
          <span>Searches</span>
        </div>
        <div className="search-stat-chip">
          <strong>
            {t.kept}
            <span className="search-stat-ratio"> / {t.contacts}</span>
          </strong>
          <span>Kept / contacts</span>
        </div>
        <div className="search-stat-chip">
          <strong>
            {t.sent}
            <span className="search-stat-ratio"> / {t.drafts}</span>
          </strong>
          <span>Sent / drafts</span>
        </div>
        <div className="search-stat-chip">
          <strong>{t.gmail_connected}</strong>
          <span>Gmail connected</span>
        </div>
      </div>

      <section className="settings-card">
        <h2>Conversion</h2>
        <p className="settings-card-kicker">
          Unique people who reached each step (not event counts).
        </p>
        <ol className="admin-funnel">
          <li>
            Signed up <strong>{f.signed_up}</strong>
          </li>
          <li>
            Orientation done <strong>{f.orientation_complete}</strong>{' '}
            <span className="muted">{pct(f.orientation_complete, f.signed_up)}</span>
          </li>
          <li>
            Resume <strong>{f.has_resume}</strong>{' '}
            <span className="muted">{pct(f.has_resume, f.signed_up)}</span>
          </li>
          <li>
            Ran a search <strong>{f.ran_search}</strong>{' '}
            <span className="muted">{pct(f.ran_search, f.signed_up)}</span>
          </li>
          <li>
            Kept a contact <strong>{f.kept_contact}</strong>{' '}
            <span className="muted">{pct(f.kept_contact, f.signed_up)}</span>
          </li>
          <li>
            Drafted <strong>{f.drafted}</strong>{' '}
            <span className="muted">{pct(f.drafted, f.signed_up)}</span>
          </li>
          <li>
            Sent email <strong>{f.sent}</strong>{' '}
            <span className="muted">{pct(f.sent, f.signed_up)}</span>
          </li>
        </ol>
      </section>

      <section className="settings-card">
        <h2>Email providers</h2>
        <p className="settings-card-kicker">
          How many accounts have each lookup toggle on.
        </p>
        <p className="admin-features">
          Tomba <strong>{t.tomba}</strong>
          {' · '}Hunter <strong>{t.hunter}</strong>
          {' · '}Apollo <strong>{t.apollo}</strong>
          {' · '}SMTP verify <strong>{t.smtp}</strong>
        </p>
      </section>

      <section className="settings-card">
        <h2>People</h2>
        <p className="settings-card-kicker">
          Click a row for their profile chat and recent searches.
        </p>
        <input
          className="admin-search"
          type="search"
          placeholder="Filter by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Last seen</th>
                <th>Orient</th>
                <th>Resume</th>
                <th>Search</th>
                <th>Kept</th>
                <th>Sent</th>
                <th>Gmail</th>
                <th>Features</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr
                  key={u.id}
                  className={openId === u.id ? 'on' : undefined}
                  onClick={() => void openUser(u.id)}
                >
                  <td>
                    <div className="admin-name">{u.name || '—'}</div>
                    <div className="muted small">{u.email || u.id.slice(0, 8)}</div>
                  </td>
                  <td>{fmtDate(u.last_sign_in_at || u.created_at)}</td>
                  <td>
                    {u.orientation_complete
                      ? 'Done'
                      : u.orientation_step || '—'}
                  </td>
                  <td>{u.resumes}</td>
                  <td>{u.searches}</td>
                  <td>
                    {u.kept}
                    <span className="muted">/{u.contacts}</span>
                  </td>
                  <td>
                    {u.sent}
                    <span className="muted">/{u.drafts}</span>
                  </td>
                  <td>{u.gmail ? 'Yes' : '—'}</td>
                  <td className="small">{featurePills(u.features)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {openId && (
        <section className="settings-card">
          <h2>
            {detail?.user.name ||
              filtered.find((u) => u.id === openId)?.name ||
              'User'}
          </h2>
          <p className="settings-card-kicker">
            {detail?.user.email ||
              filtered.find((u) => u.id === openId)?.email ||
              openId}
            {detail?.user.orientation_step
              ? ` · orientation ${detail.user.orientation_complete ? 'done' : detail.user.orientation_step}`
              : ''}
          </p>
          {detailLoading && <p className="muted">Loading conversation…</p>}
          {detailErr && <p className="flash error">{detailErr}</p>}
          {detail && (
            <>
              {detail.search_profile && (
                <p className="small">
                  {detail.search_profile_name
                    ? `${detail.search_profile_name} · `
                    : ''}
                  Roles:{' '}
                  {(detail.search_profile.roles || []).join(', ') || '—'}
                  {' · '}Industries:{' '}
                  {(detail.search_profile.industries || []).join(', ') || '—'}
                  {' · '}Seniority:{' '}
                  {detail.search_profile.seniority || '—'}
                </p>
              )}
              {detail.chat_summary && (
                <p className="admin-summary">{detail.chat_summary}</p>
              )}
              <h3 className="admin-sub">Profile chat</h3>
              {detail.chat.length === 0 ? (
                <p className="muted small">No chat yet.</p>
              ) : (
                <ul className="admin-chat">
                  {detail.chat.map((m, i) => (
                    <li key={`${m.created_at}-${i}`} className={m.role}>
                      <span className="admin-chat-role">{m.role}</span>
                      <p>{m.content}</p>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="admin-sub">Recent searches</h3>
              {detail.searches.length === 0 ? (
                <p className="muted small">No searches yet.</p>
              ) : (
                <ul className="admin-runs">
                  {detail.searches.map((s) => (
                    <li key={s.id}>
                      <strong>{s.status}</strong>
                      {s.stage ? ` · ${s.stage}` : ''}
                      {s.message ? ` — ${s.message}` : ''}
                      <span className="muted small"> {fmtDate(s.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
