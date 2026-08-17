import { Navigate, Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useOrientation } from '../lib/orientationContext'
import { pathForStep, type AppPage } from '../lib/orientation'
import { prefetchDrafts } from '../lib/draftsCache'
import { invokeFunction } from '../lib/api'
import { FollowUpLogo } from './FollowUpLogo'

export function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return <div className="page-center muted">Loading…</div>
  if (!user) return <Navigate to="/" replace />
  return <Outlet />
}

const NAV: { to: string; label: string; page: AppPage; end?: boolean }[] = [
  { to: '/app/onboarding', label: 'Profile', page: 'profile' },
  { to: '/app/filters', label: 'Filters', page: 'filters' },
  { to: '/app/search', label: 'Search', page: 'search' },
  { to: '/app/contacts', label: 'Contacts', page: 'contacts' },
  { to: '/app/drafts', label: 'Drafts', page: 'drafts' },
  { to: '/app/settings', label: 'Settings', page: 'settings' },
]

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const orientation = useOrientation()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!user) return
    void prefetchDrafts(user.id)
  }, [user, location.pathname])

  useEffect(() => {
    if (!user) {
      setIsAdmin(false)
      return
    }
    let cancelled = false
    void invokeFunction('admin-crm', { view: 'whoami' })
      .then(() => {
        if (!cancelled) setIsAdmin(true)
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  if (orientation.loading) {
    return <div className="page-center muted">Loading…</div>
  }

  // Keep users on the allowed page during orientation
  if (!orientation.complete) {
    const allowed = orientation.pathForCurrent
    const onWelcome = location.pathname.includes('/welcome')
    const onAdmin = location.pathname.includes('/admin')
    if (!onWelcome && !onAdmin) {
      const page = pageFromNav(location.pathname)
      if (page && !orientation.canAccess(page)) {
        return <Navigate to={allowed} replace />
      }
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          type="button"
          className="brand-mark"
          onClick={() =>
            navigate(
              orientation.canAccess('search')
                ? '/app/search'
                : pathForStep(orientation.step),
            )
          }
        >
          <FollowUpLogo size={26} alt="" />
          FollowUp
        </button>
        <nav className="side-nav">
          {NAV.map((item) => {
            const unlocked = orientation.canAccess(item.page)
            if (!unlocked) {
              return (
                <span
                  key={item.to}
                  className="nav-locked"
                  title="Finish orientation to unlock"
                  aria-disabled="true"
                >
                  {item.label}
                </span>
              )
            }
            return (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {item.label}
              </NavLink>
            )
          })}
          {isAdmin && (
            <NavLink to="/app/admin">Admin</NavLink>
          )}
        </nav>
        <div className="side-footer">
          <p className="muted small">{user?.email}</p>
          <button type="button" className="btn ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="app-content">
        {!orientation.complete && (
          <div className="orientation-bar" role="status">
            <div className="orientation-bar-top">
              <span className="orientation-label">Orientation</span>
              <span className="orientation-step">{orientation.label}</span>
            </div>
            <div className="orientation-track" aria-hidden="true">
              <div
                className="orientation-fill"
                style={{ width: `${Math.round(orientation.fraction * 100)}%` }}
              />
            </div>
          </div>
        )}
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function pageFromNav(pathname: string): AppPage | null {
  if (pathname.includes('/onboarding')) return 'profile'
  if (pathname.includes('/filters')) return 'filters'
  if (pathname.includes('/refine')) return 'refine'
  if (pathname.includes('/contacts')) return 'contacts'
  if (pathname.includes('/drafts')) return 'drafts'
  if (pathname.includes('/settings')) return 'settings'
  if (pathname.includes('/search') || pathname.match(/\/app\/?$/)) return 'search'
  return null
}
