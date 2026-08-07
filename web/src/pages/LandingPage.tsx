import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'

export function LandingPage() {
  const { user, loading, signInWithGoogle } = useAuth()

  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-top">
        <span className="logo">FollowUp</span>
        {!loading && user ? (
          <Link className="btn" to="/app">
            Open app
          </Link>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => signInWithGoogle()}
          >
            Sign in with Google
          </button>
        )}
      </header>

      <section className="hero">
        <h1 className="hero-brand">FollowUp</h1>
        <p className="hero-line">
          Skip the application black hole. Reach the managers who actually hire.
        </p>
        <p className="hero-sub">
          Upload your resume, shape a search profile with AI, find hiring
          managers—not recruiters—verify their emails, and send outreach from
          your own Gmail with your resume attached.
        </p>
        <div className="hero-cta">
          {user ? (
            <Link className="btn primary" to="/app">
              Continue
            </Link>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => signInWithGoogle()}
            >
              Get started
            </button>
          )}
        </div>
      </section>

      <section className="landing-how">
        <h2>How it works</h2>
        <ol>
          <li>Build a search profile from your resume and a short AI chat.</li>
          <li>Tune title filters so you only contact real managers.</li>
          <li>AI searches the web for fitting employers, then finds people in similar roles and drafts outreach.</li>
          <li>You review, confirm, and send from your Gmail.</li>
        </ol>
      </section>
    </div>
  )
}
