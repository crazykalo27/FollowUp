import { Navigate } from 'react-router-dom'
import { ResumeStudio } from '../resume/ResumeStudio'

/** Dev-only stand-in so the resume studio can be clicked without a Supabase session. */
export function ResumeDevPreview() {
  if (!import.meta.env.DEV) return <Navigate to="/" replace />
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-mark" href="/">FollowUp</a>
        <nav className="side-nav">
          <a href="/app/search">Search</a>
          <a href="/app/contacts">Contacts</a>
          <a href="/dev/resume" className="active">Resume</a>
          <a href="/app/settings">Settings</a>
          <a href="/">Landing</a>
        </nav>
      </aside>
      <div className="app-content">
        <main className="app-main">
          <ResumeStudio userId="dev-preview" email="preview@local" basePath="/dev/resume" />
        </main>
      </div>
    </div>
  )
}
