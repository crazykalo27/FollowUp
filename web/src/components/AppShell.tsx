import { Navigate, Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function RequireAuth() {
  const { user, loading } = useAuth()
  if (loading) return <div className="page-center muted">Loading…</div>
  if (!user) return <Navigate to="/" replace />
  return <Outlet />
}

export function AppShell() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          type="button"
          className="brand-mark"
          onClick={() => navigate('/app')}
        >
          FollowUp
        </button>
        <nav className="side-nav">
          <NavLink to="/app" end>
            Overview
          </NavLink>
          <NavLink to="/app/onboarding">Profile</NavLink>
          <NavLink to="/app/filters">Filters</NavLink>
          <NavLink to="/app/contacts">Contacts</NavLink>
          <NavLink to="/app/drafts">Drafts</NavLink>
          <NavLink to="/app/settings">Settings</NavLink>
        </nav>
        <div className="side-footer">
          <p className="muted small">{user?.email}</p>
          <button type="button" className="btn ghost" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
