import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useReveal } from '../lib/useReveal'
import './landing.css'

function PrimaryCta({
  label,
  className = 'btn primary',
}: {
  label: string
  className?: string
}) {
  const { user, loading, signInWithGoogle } = useAuth()

  if (loading) {
    return (
      <button type="button" className={className} disabled>
        {label}
      </button>
    )
  }

  if (user) {
    return (
      <Link className={className} to="/app">
        {label}
      </Link>
    )
  }

  return (
    <button type="button" className={className} onClick={() => signInWithGoogle()}>
      {label}
    </button>
  )
}

function SignInControl() {
  const { user, loading, signInWithGoogle } = useAuth()

  if (loading) return null

  if (user) {
    return (
      <Link className="lp-nav-sign" to="/app">
        Open app
      </Link>
    )
  }

  return (
    <button
      type="button"
      className="lp-nav-sign"
      onClick={() => signInWithGoogle()}
    >
      Sign in
    </button>
  )
}

function JourneyStep({
  num,
  title,
  body,
}: {
  num: string
  title: string
  body: string
}) {
  const ref = useReveal<HTMLLIElement>()

  return (
    <li ref={ref} className="lp-journey-step lp-reveal">
      <span className="lp-journey-num">{num}</span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </li>
  )
}

function RevealBlock({
  children,
  className = '',
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useReveal<HTMLDivElement>()
  const delayClass =
    delay === 1 ? 'lp-reveal-delay-1' : delay === 2 ? 'lp-reveal-delay-2' : delay === 3 ? 'lp-reveal-delay-3' : ''

  return (
    <div ref={ref} className={`lp-reveal ${delayClass} ${className}`.trim()}>
      {children}
    </div>
  )
}

export function LandingPage() {
  const [navSolid, setNavSolid] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setNavSolid(window.scrollY > 32)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollTo = useCallback((id: string) => {
    setMenuOpen(false)
    const el = document.getElementById(id)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden />

      <header className={`lp-nav ${navSolid ? 'is-solid' : ''}`}>
        <Link className="lp-nav-logo" to="/">
          FollowUp
        </Link>
        <nav className="lp-nav-links" aria-label="Primary">
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault()
              scrollTo('how-it-works')
            }}
          >
            How it works
          </a>
          <a
            href="#why-followup"
            onClick={(e) => {
              e.preventDefault()
              scrollTo('why-followup')
            }}
          >
            Why FollowUp
          </a>
        </nav>
        <div className="lp-nav-cta">
          <SignInControl />
          <PrimaryCta label="Get started" className="btn primary btn-sm" />
          <button
            type="button"
            className="lp-nav-menu"
            aria-expanded={menuOpen}
            aria-label="Menu"
            onClick={() => setMenuOpen((o) => !o)}
          >
            Menu
          </button>
        </div>
      </header>

      {menuOpen && (
        <nav className="lp-nav-drawer is-open" aria-label="Mobile">
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault()
              scrollTo('how-it-works')
            }}
          >
            How it works
          </a>
          <a
            href="#why-followup"
            onClick={(e) => {
              e.preventDefault()
              scrollTo('why-followup')
            }}
          >
            Why FollowUp
          </a>
          <SignInControl />
        </nav>
      )}

      <main>
        <section className="lp-hero lp-inner">
          <div className="lp-hero-grid">
            <div className="lp-hero-copy">
              <h1>
                Skip the application black hole.
                <span className="lp-hero-em">Reach the people who actually hire.</span>
              </h1>
              <p className="lp-hero-lede">
                FollowUp finds the companies and people worth reaching out to, helps you write
                the message, and lets you send it from your own Gmail.
              </p>
              <div className="lp-hero-actions">
                <PrimaryCta label="Build your search" />
                <button
                  type="button"
                  className="btn"
                  onClick={() => scrollTo('how-it-works')}
                >
                  See how it works
                </button>
              </div>
              <div className="lp-workflow" aria-hidden>
                <span>Your search</span>
                <span className="lp-flow-arrow">↓</span>
                <span>Companies worth targeting</span>
                <span className="lp-flow-arrow">↓</span>
                <span>People worth contacting</span>
                <span className="lp-flow-arrow">↓</span>
                <span>Personalized outreach</span>
                <span className="lp-flow-arrow">↓</span>
                <span>Conversation</span>
              </div>
            </div>

            <RevealBlock>
              <div className="lp-contrast">
                <div className="lp-contrast-panel traditional">
                  <h3>Traditional job search</h3>
                  <ul className="lp-contrast-list">
                    <li><strong>127</strong> applications</li>
                    <li><strong>0</strong> responses</li>
                    <li>&ldquo;Application submitted&rdquo;</li>
                    <li>Generic recruiter inbox</li>
                    <li>Waiting&hellip;</li>
                  </ul>
                </div>
                <div className="lp-contrast-divider" aria-hidden>→</div>
                <div className="lp-contrast-panel followup">
                  <h3>FollowUp</h3>
                  <ul className="lp-contrast-list">
                    <li><strong>12</strong> companies</li>
                    <li><strong>31</strong> relevant people</li>
                    <li>Hiring manager</li>
                    <li>Senior engineer</li>
                    <li>Personalized message</li>
                    <li>Gmail → Sent</li>
                  </ul>
                </div>
              </div>
            </RevealBlock>
          </div>
        </section>

        <section className="lp-section lp-section-border lp-inner">
          <RevealBlock>
            <h2>The job search was built around applications.</h2>
            <p className="lp-section-lede">
              But applications are only one way into a company.
            </p>
          </RevealBlock>
          <div className="lp-problem-layout">
            <RevealBlock delay={1}>
              <div className="lp-black-hole">
                <div className="lp-black-hole-grid">
                  {Array.from({ length: 24 }, (_, i) => (
                    <div key={i} className="lp-hole-cell">Applied</div>
                  ))}
                </div>
                <div className="lp-cut-through" aria-hidden />
              </div>
            </RevealBlock>
            <div className="lp-problem-cards">
              <RevealBlock delay={1}>
                <div className="lp-problem-card">
                  <h3>Application portals</h3>
                  <p>Upload resume. Fill out forms. Click submit. Wait.</p>
                </div>
              </RevealBlock>
              <RevealBlock delay={2}>
                <div className="lp-problem-card">
                  <h3>Generic outreach</h3>
                  <p>
                    Send your resume into a recruiter inbox shared by hundreds of applicants.
                  </p>
                </div>
              </RevealBlock>
              <RevealBlock delay={3}>
                <div className="lp-problem-card highlight">
                  <h3>FollowUp</h3>
                  <p>Find the people closest to the work you actually want to do.</p>
                </div>
              </RevealBlock>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="lp-section lp-section-border lp-inner"
        >
          <RevealBlock>
            <h2>How FollowUp works</h2>
            <p className="lp-section-lede">
              A short journey from intent to conversation—not four disconnected features.
            </p>
          </RevealBlock>
          <ol className="lp-journey">
            <JourneyStep
              num="01"
              title="Tell us what you're looking for"
              body="Upload your resume and have a short AI conversation about roles, industries, companies, locations, and preferences."
            />
            <JourneyStep
              num="02"
              title="Find the right companies"
              body="FollowUp searches the open web for employers that actually match your profile."
            />
            <JourneyStep
              num="03"
              title="Find the right people"
              body="Instead of stopping at the company, FollowUp finds relevant people—especially hiring managers and peers in similar roles."
            />
            <JourneyStep
              num="04"
              title="Reach out like yourself"
              body="FollowUp drafts personalized outreach. Review it, edit it, and send it through your own Gmail."
            />
          </ol>
        </section>

        <section className="lp-section lp-section-border lp-inner">
          <RevealBlock>
            <h2>Inside the product</h2>
            <p className="lp-section-lede">
              Review real people, keep the fits, and teach the search what you want next.
            </p>
          </RevealBlock>
          <RevealBlock delay={1}>
            <div className="lp-mock-wrap">
              <div className="lp-mock">
                <aside className="lp-mock-side" aria-hidden>
                  <div className="lp-mock-brand">FollowUp</div>
                  <div className="lp-mock-nav-item">Profile</div>
                  <div className="lp-mock-nav-item">Filters</div>
                  <div className="lp-mock-nav-item">Search</div>
                  <div className="lp-mock-nav-item active">Contacts</div>
                  <div className="lp-mock-nav-item">Drafts</div>
                  <div className="lp-mock-nav-item">Settings</div>
                </aside>
                <div className="lp-mock-main">
                  <h3>Contacts</h3>
                  <div className="lp-mock-card">
                    <p className="lp-mock-name">Jane Smith</p>
                    <p className="lp-mock-role">Senior Firmware Engineer</p>
                    <p className="lp-mock-company">Example Robotics</p>
                    <div className="lp-mock-why">
                      <span className="lp-mock-why-label">Why they&apos;re relevant</span>
                      <ul>
                        <li>Firmware</li>
                        <li>Embedded systems</li>
                        <li>Similar technical background</li>
                      </ul>
                    </div>
                    <div className="lp-mock-actions">
                      <span className="btn primary btn-sm">Keep</span>
                      <span className="btn btn-sm swipe-discard">Discard</span>
                    </div>
                    <div className="lp-mock-chips">
                      <span className="lp-mock-chip on">Relevant role</span>
                      <span className="lp-mock-chip">Wrong seniority</span>
                      <span className="lp-mock-chip on">Good company</span>
                      <span className="lp-mock-chip">Not a fit</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </RevealBlock>
        </section>

        <section
          id="why-followup"
          className="lp-statement lp-section-border lp-inner"
        >
          <RevealBlock>
            <div className="lp-statement-inner">
              <p className="lp-statement-line">
                We&apos;re not trying to help you apply to more jobs.
              </p>
              <p className="lp-statement-line strong">
                We&apos;re trying to help you reach better people.
              </p>
              <p className="lp-statement-support">
                FollowUp treats job boards as signals—not destinations. The goal is to understand
                where opportunities exist, identify the people connected to those opportunities,
                and help you start a conversation.
              </p>
            </div>
          </RevealBlock>
        </section>

        <section className="lp-section lp-section-border lp-inner">
          <RevealBlock>
            <h2>Your email. Your voice. Your decision.</h2>
            <p className="lp-section-lede">
              FollowUp does not behave like a bulk outreach platform. It&apos;s a co-pilot—not an
              autonomous spam machine.
            </p>
          </RevealBlock>
          <div className="lp-personal-grid">
            <RevealBlock delay={1}>
              <ul className="lp-check-list">
                <li>Resume attached ✓</li>
                <li>Personalized message ✓</li>
                <li>Your Gmail ✓</li>
                <li>You approve every send ✓</li>
              </ul>
            </RevealBlock>
            <RevealBlock delay={2}>
              <ul className="lp-x-list">
                <li>✕ Bulk sequences</li>
                <li>✕ Mass recruiter spam</li>
                <li>✕ Automated blasts</li>
              </ul>
            </RevealBlock>
          </div>
        </section>

        <section className="lp-final lp-inner">
          <RevealBlock>
            <h2>Stop waiting for the application portal.</h2>
            <p>Find the people worth talking to.</p>
            <PrimaryCta label="Start your search" />
          </RevealBlock>
        </section>
      </main>

      <footer className="lp-footer">FollowUp — outreach that starts with people.</footer>
    </div>
  )
}
