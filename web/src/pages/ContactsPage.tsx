import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'

type ContactRow = {
  id: string
  company_id: string
  full_name: string | null
  title: string | null
  email: string | null
  verification_status: string | null
  filter_match_reason: string | null
  discovery_source: string | null
  linkedin_url: string | null
  sources: string[] | null
  review_status: string | null
  source_details: {
    hiring_signal?: string
    hiring_signal_url?: string
    job_source?: string
  } | null
  companies: {
    id: string
    name: string
    domain: string | null
    hiring_signal_title: string | null
    hiring_signal_url: string | null
    user_flag: 'favorite' | 'avoid' | null
  } | null
}

const DISCARD_REASONS = [
  { id: 'recruiter_hr', label: 'Recruiter / HR' },
  { id: 'wrong_seniority', label: 'Wrong seniority' },
  { id: 'wrong_role', label: 'Wrong role / title' },
  { id: 'wrong_industry', label: 'Wrong industry' },
  { id: 'wrong_location', label: 'Wrong location' },
  { id: 'not_hiring_manager', label: 'Not a hiring manager' },
  { id: 'company_mismatch', label: 'Company isn’t a fit' },
  { id: 'other', label: 'Other' },
] as const

const KEEP_REASONS = [
  { id: 'right_role', label: 'Right role / title' },
  { id: 'right_seniority', label: 'Right seniority' },
  { id: 'right_industry', label: 'Right industry / company type' },
  { id: 'hiring_fit', label: 'Likely hires for my roles' },
  { id: 'strong_company', label: 'Strong company fit' },
  { id: 'good_signal', label: 'Good hiring signal' },
  { id: 'referrer_potential', label: 'Good referral / intro path' },
  { id: 'other', label: 'Other' },
] as const

function contactSources(r: ContactRow) {
  return r.sources?.length
    ? r.sources
    : r.discovery_source
      ? [r.discovery_source]
      : []
}

function ContactDetail({ contact }: { contact: ContactRow }) {
  const hiring =
    contact.source_details?.hiring_signal ||
    contact.companies?.hiring_signal_title ||
    null
  const hiringUrl =
    contact.source_details?.hiring_signal_url ||
    contact.companies?.hiring_signal_url ||
    null

  return (
    <>
      <header className="contact-card-top">
        <span className="contact-name">{contact.full_name || 'Unknown'}</span>
        <div className="source-pills">
          {contactSources(contact).map((s) => (
            <span key={s} className={`pill source-${s}`}>
              {s}
            </span>
          ))}
        </div>
      </header>

      <p className="contact-title">{contact.title || 'Title unknown'}</p>
      <p className="muted company-line">
        {contact.companies?.name}
        {contact.companies?.domain ? ` · ${contact.companies.domain}` : ''}
        {contact.companies?.user_flag === 'favorite' && (
          <span className="pill company-favorite">Favorite</span>
        )}
        {contact.companies?.user_flag === 'avoid' && (
          <span className="pill company-avoid">Avoid</span>
        )}
      </p>

      {hiring && (
        <p className="hiring-signal">
          Hiring signal:{' '}
          {hiringUrl ? (
            <a href={hiringUrl} target="_blank" rel="noreferrer">
              {hiring}
            </a>
          ) : (
            hiring
          )}
        </p>
      )}

      <p className="small muted why">{contact.filter_match_reason}</p>

      <div className="contact-meta">
        <div>
          <span className="muted small">Email</span>
          <div>{contact.email || '—'}</div>
          {contact.verification_status && (
            <span className="muted small">{contact.verification_status}</span>
          )}
        </div>
      </div>

      {contact.linkedin_url && (
        <a
          className="btn"
          href={contact.linkedin_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          LinkedIn
        </a>
      )}
    </>
  )
}

function ContactPeek({ contact }: { contact: ContactRow }) {
  return (
    <>
      <span className="contact-name peek-name">
        {contact.full_name || 'Unknown'}
      </span>
      <p className="small muted">{contact.title || 'Title unknown'}</p>
      <p className="small muted">{contact.companies?.name || '—'}</p>
    </>
  )
}

export function ContactsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const orientLockDiscard = !orientation.complete
  const [rows, setRows] = useState<ContactRow[]>([])
  const [busy, setBusy] = useState(false)
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discardTargetId, setDiscardTargetId] = useState<string | null>(null)
  const [keepOpen, setKeepOpen] = useState(false)
  const [selectedKeepReasons, setSelectedKeepReasons] = useState<string[]>([])
  const [keepNote, setKeepNote] = useState('')
  const [selectedReasons, setSelectedReasons] = useState<string[]>([])
  const [discardNote, setDiscardNote] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ContactRow | null>(null)
  const [discardCompanyOpen, setDiscardCompanyOpen] = useState(false)
  const [swipeDir, setSwipeDir] = useState<'left' | 'right' | null>(null)
  const [tab, setTab] = useState<'review' | 'kept' | 'archived'>('review')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dragX, setDragX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const deckRef = useRef<HTMLDivElement | null>(null)
  const reviewChainRef = useRef<Promise<void>>(Promise.resolve())
  const [exiting, setExiting] = useState<ContactRow | null>(null)
  const [syncPending, setSyncPending] = useState(0)
  const [sentOutreachIds, setSentOutreachIds] = useState<Set<string>>(
    () => new Set(),
  )

  const load = useCallback(async () => {
    if (!user) return
    const [{ data }, { data: sentRows }] = await Promise.all([
      supabase
        .from('contacts')
        .select(
          'id, company_id, full_name, title, email, verification_status, filter_match_reason, discovery_source, linkedin_url, sources, review_status, source_details, companies(id, name, domain, hiring_signal_title, hiring_signal_url, user_flag)',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('outreach_drafts')
        .select('contact_id')
        .eq('user_id', user.id)
        .eq('status', 'sent'),
    ])
    setSentOutreachIds(
      new Set((sentRows || []).map((r) => r.contact_id as string)),
    )
    setRows(
      (data || []).map((r) => ({
        ...r,
        companies: Array.isArray(r.companies) ? r.companies[0] : r.companies,
      })) as ContactRow[],
    )
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  const pending = useMemo(
    () => rows.filter((r) => (r.review_status || 'pending') === 'pending'),
    [rows],
  )
  const kept = useMemo(
    () => rows.filter((r) => r.review_status === 'kept'),
    [rows],
  )
  const archived = useMemo(
    () => rows.filter((r) => r.review_status === 'archived'),
    [rows],
  )

  // Keep activeId pointing at a pending card; default to first
  useEffect(() => {
    if (pending.length === 0) {
      setActiveId(null)
      return
    }
    if (!activeId || !pending.some((p) => p.id === activeId)) {
      setActiveId(pending[0].id)
    }
  }, [pending, activeId])

  const current = useMemo(
    () => pending.find((p) => p.id === activeId) || pending[0] || null,
    [pending, activeId],
  )

  const currentIndex = useMemo(() => {
    if (!current) return -1
    return pending.findIndex((p) => p.id === current.id)
  }, [pending, current])

  const leftPeeks = useMemo(() => {
    if (currentIndex <= 0) return []
    return pending.slice(Math.max(0, currentIndex - 2), currentIndex)
  }, [pending, currentIndex])

  const rightPeeks = useMemo(() => {
    if (currentIndex < 0) return []
    return pending.slice(currentIndex + 1, currentIndex + 3)
  }, [pending, currentIndex])

  const pendingAtCompany = useMemo(() => {
    if (!current?.company_id) return 0
    return pending.filter((p) => p.company_id === current.company_id).length
  }, [pending, current])

  function enqueueCompanyAction(
    company_action: 'discard_all' | 'favorite',
    contact_id: string,
    rollback: () => void,
  ) {
    setSyncPending((n) => n + 1)
    reviewChainRef.current = reviewChainRef.current
      .then(async () => {
        await invokeFunction<{
          contacts_discarded?: number
          pending_remaining: number
        }>('review-contact', {
          contact_id,
          company_action,
        })
      })
      .catch((e) => {
        rollback()
        setMsg(
          e instanceof Error
            ? `Could not save — ${e.message}`
            : 'Could not save company action.',
        )
      })
      .finally(() => {
        setSyncPending((n) => Math.max(0, n - 1))
      })
  }

  function enqueueReview(
    payload: {
      contact_id: string
      decision: 'keep' | 'discard'
      reasons: string[]
      note: string
    },
    snapshot: ContactRow,
  ) {
    const priorStatus = snapshot.review_status || 'pending'
    setSyncPending((n) => n + 1)
    reviewChainRef.current = reviewChainRef.current
      .then(async () => {
        await invokeFunction<{
          pending_remaining: number
          preference_summary?: string | null
        }>('review-contact', {
          contact_id: payload.contact_id,
          decision: payload.decision,
          reasons: payload.reasons,
          note: payload.note || undefined,
        })
      })
      .catch((e) => {
        setRows((prev) =>
          prev.map((r) =>
            r.id === snapshot.id ? { ...r, review_status: priorStatus } : r,
          ),
        )
        setMsg(
          e instanceof Error
            ? `Could not save review — ${e.message}. Restored previous status.`
            : 'Could not save review. Restored previous status.',
        )
      })
      .finally(() => {
        setSyncPending((n) => Math.max(0, n - 1))
      })
  }

  function enqueueContactAction(
    action: 'archive' | 'delete',
    contactId: string,
    snapshot: ContactRow,
  ) {
    setSyncPending((n) => n + 1)
    reviewChainRef.current = reviewChainRef.current
      .then(async () => {
        await invokeFunction('review-contact', {
          contact_id: contactId,
          action,
        })
      })
      .catch((e) => {
        if (action === 'delete') {
          setRows((prev) => [...prev, snapshot])
        } else {
          setRows((prev) =>
            prev.map((r) =>
              r.id === contactId ? { ...r, review_status: snapshot.review_status } : r,
            ),
          )
        }
        setMsg(
          e instanceof Error ? e.message : 'Could not complete that action.',
        )
      })
      .finally(() => {
        setSyncPending((n) => Math.max(0, n - 1))
      })
  }

  function applyDecision(
    decision: 'keep' | 'discard',
    reasons: string[] = [],
    note = '',
    target?: ContactRow,
  ) {
    const subject = target || current
    if (!subject || busy) return

    if (decision === 'discard' && orientLockDiscard) {
      setMsg('During orientation, find one contact to Keep — Discard unlocks after.')
      return
    }

    if (decision === 'discard' && reasons.length === 0 && !note.trim()) {
      return
    }

    const deciding = subject
    const decidingId = deciding.id
    const isReviewQueue = (deciding.review_status || 'pending') === 'pending'
    const nextId = isReviewQueue
      ? pending.find((p) => p.id !== decidingId)?.id || null
      : null
    const reviewStatus = decision === 'keep' ? 'kept' : 'discarded'

    setBusy(true)
    setMsg(null)
    setDiscardOpen(false)
    setDiscardTargetId(null)
    setKeepOpen(false)
    setSelectedReasons([])
    setDiscardNote('')
    setSelectedKeepReasons([])
    setKeepNote('')
    setDragX(0)

    if (isReviewQueue) {
      setExiting(deciding)
      setSwipeDir(decision === 'keep' ? 'right' : 'left')
      setActiveId(nextId)
    }

    setRows((prev) =>
      prev.map((r) =>
        r.id === decidingId ? { ...r, review_status: reviewStatus } : r,
      ),
    )

    enqueueReview(
      {
        contact_id: decidingId,
        decision,
        reasons,
        note,
      },
      deciding,
    )

    if (decision === 'keep' && orientLockDiscard) {
      void orientation.advanceTo('drafts').then(() => {
        navigate(`/app/drafts?contact=${decidingId}`)
      })
    }

    if (isReviewQueue) {
      window.setTimeout(() => {
        setExiting(null)
        setSwipeDir(null)
        setBusy(false)
      }, 220)
    } else {
      setBusy(false)
      setMsg(
        decision === 'discard'
          ? 'Moved to discard — preference learning updated.'
          : 'Contact updated.',
      )
    }
  }

  function archiveContact(row: ContactRow) {
    if (busy) return
    const snapshot = row
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, review_status: 'archived' } : r,
      ),
    )
    setMsg(`Archived ${row.full_name || 'contact'} (no negative signal).`)
    enqueueContactAction('archive', row.id, snapshot)
  }

  function deleteContact(row: ContactRow) {
    if (busy) return
    const snapshot = row
    setDeleteTarget(null)
    setRows((prev) => prev.filter((r) => r.id !== row.id))
    setMsg(`Deleted ${row.full_name || 'contact'}.`)
    enqueueContactAction('delete', row.id, snapshot)
  }

  function applyFavoriteCompany() {
    if (!current || busy || !current.company_id) return
    const companyId = current.company_id
    const companyName = current.companies?.name || 'this company'
    const snapshot = rows

    setRows((prev) =>
      prev.map((r) => {
        if (r.company_id !== companyId || !r.companies) return r
        return {
          ...r,
          companies: { ...r.companies, user_flag: 'favorite' as const },
        }
      }),
    )
    setMsg(`Favorited ${companyName} — future searches will prioritize it.`)

    enqueueCompanyAction('favorite', current.id, () => setRows(snapshot))
  }

  function applyDiscardAllAtCompany() {
    if (!current || busy || !current.company_id) return
    const companyId = current.company_id
    const companyName = current.companies?.name || 'this company'
    const snapshot = rows
    const count = pendingAtCompany
    const nextId =
      pending.find((p) => p.company_id !== companyId)?.id || null

    setBusy(true)
    setDiscardCompanyOpen(false)
    setMsg(null)
    setExiting(current)
    setSwipeDir('left')
    setActiveId(nextId)

    setRows((prev) =>
      prev.map((r) => {
        const flagPatch =
          r.company_id === companyId && r.companies
            ? { ...r.companies, user_flag: 'avoid' as const }
            : r.companies
        if (
          r.company_id === companyId &&
          (r.review_status || 'pending') === 'pending'
        ) {
          return { ...r, review_status: 'discarded', companies: flagPatch }
        }
        if (r.company_id === companyId) {
          return { ...r, companies: flagPatch }
        }
        return r
      }),
    )
    setMsg(`Discarded ${count} contact(s) at ${companyName}.`)

    enqueueCompanyAction('discard_all', current.id, () => setRows(snapshot))

    window.setTimeout(() => {
      setExiting(null)
      setSwipeDir(null)
      setBusy(false)
    }, 220)
  }

  function selectContact(id: string) {
    if (busy) return
    setSwipeDir(null)
    setDragX(0)
    setActiveId(id)
    deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  function toggleReason(id: string) {
    setSelectedReasons((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function toggleKeepReason(id: string) {
    setSelectedKeepReasons((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function openDiscard(target?: ContactRow) {
    if (orientLockDiscard) {
      setMsg('During orientation, find one contact to Keep — Discard unlocks after.')
      return
    }
    setSelectedReasons([])
    setDiscardNote('')
    setDiscardTargetId(target?.id ?? current?.id ?? null)
    setDiscardOpen(true)
  }

  function openKeep() {
    setSelectedKeepReasons([])
    setKeepNote('')
    setKeepOpen(true)
  }

  const discardSubject = useMemo(() => {
    if (discardTargetId) {
      return rows.find((r) => r.id === discardTargetId) || null
    }
    return current
  }, [discardTargetId, rows, current])

  function onPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (busy || !current) return
    if ((e.target as HTMLElement).closest('a, button')) return
    dragStart.current = { x: e.clientX, y: e.clientY }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    if (!dragging || !dragStart.current) return
    let dx = e.clientX - dragStart.current.x
    if (orientLockDiscard && dx < 0) dx = 0
    setDragX(dx)
  }

  function onPointerUp() {
    if (!dragging) return
    setDragging(false)
    dragStart.current = null
    if (dragX > 110) {
      applyDecision('keep')
    } else if (dragX < -110 && !orientLockDiscard) {
      openDiscard()
      setDragX(0)
    } else {
      setDragX(0)
    }
  }

  async function draftOne(id: string) {
    setDraftingId(id)
    setMsg(null)
    try {
      const res = await invokeFunction<{
        drafts: unknown[]
        skipped_already_sent?: Array<{ contact_id: string; name: string | null }>
      }>('draft-emails', {
        contact_ids: [id],
      })
      if (res.skipped_already_sent?.length) {
        setMsg(
          'Outreach was already sent to this person. Follow up from your Gmail inbox.',
        )
        void load()
        return
      }
      setMsg(`Draft ready (${res.drafts.length}). Open Drafts to review.`)
      void load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setDraftingId(null)
    }
  }

  async function draftKept() {
    setBusy(true)
    setMsg(null)
    try {
      const ids = kept.filter((r) => r.email).map((r) => r.id).slice(0, 15)
      if (ids.length === 0) {
        setMsg('No kept contacts with email yet.')
        return
      }
      const res = await invokeFunction<{
        drafts: unknown[]
        skipped_already_sent?: Array<{ contact_id: string; name: string | null }>
      }>('draft-emails', {
        contact_ids: ids,
      })
      const skipped = res.skipped_already_sent?.length ?? 0
      const created = res.drafts.length
      if (created === 0 && skipped > 0) {
        setMsg(
          'No new drafts — everyone selected already has outreach sent. Follow up in Gmail.',
        )
      } else if (skipped > 0) {
        setMsg(
          `Created ${created} draft(s). Skipped ${skipped} already sent — follow up in Gmail.`,
        )
      } else {
        setMsg(`Created ${created} draft(s) from kept contacts.`)
      }
      void load()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setBusy(false)
    }
  }

  const dragStyle =
    swipeDir === 'left'
      ? undefined
      : swipeDir === 'right'
        ? undefined
        : {
            transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)`,
            transition: dragging ? 'none' : 'transform 0.2s ease',
          }

  return (
    <div className="panel">
      <h1>Contacts</h1>
      <p className="lede">
        {orientLockDiscard
          ? 'Review the people we found. Keep someone worth emailing to continue.'
          : 'Swipe or use Keep / Discard on the center card. Click a side card to review that contact.'}
      </p>

      {orientLockDiscard && (
        <div className="orientation-coach">
          <p>
            <strong>Keep</strong> means this person is a good outreach target —
            we’ll draft an email to them next.
          </p>
          <p>
            <strong>Discard</strong> removes people who aren’t a fit and teaches
            the search what to avoid. Discard stays locked until you Keep one
            contact and finish orientation.
          </p>
          <p className="muted small">Find one contact to Keep to continue.</p>
        </div>
      )}

      <div className="tab-row">
        <button
          type="button"
          className={`tab ${tab === 'review' ? 'active' : ''}`}
          onClick={() => setTab('review')}
        >
          Review ({pending.length})
        </button>
        {!orientLockDiscard && (
          <>
            <button
              type="button"
              className={`tab ${tab === 'kept' ? 'active' : ''}`}
              onClick={() => setTab('kept')}
            >
              Kept ({kept.length})
            </button>
            <button
              type="button"
              className={`tab ${tab === 'archived' ? 'active' : ''}`}
              onClick={() => setTab('archived')}
            >
              Archived ({archived.length})
            </button>
            <Link className="btn" to="/app/drafts">
              Open drafts
            </Link>
          </>
        )}
        <button type="button" className="btn ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {msg && <p className="flash">{msg}</p>}
      {syncPending > 0 && (
        <p className="muted small">Saving {syncPending} review(s) in background…</p>
      )}

      {tab === 'review' && (
        <div className="review-layout">
          <div className="review-stage" ref={deckRef}>
            {!current && (
              <p className="muted review-empty">
                {rows.length === 0
                  ? 'No contacts yet. Run a people search from Search.'
                  : 'You’re caught up — no pending contacts. Check Kept, or run another search.'}
              </p>
            )}

            {current && (
              <>
                <p className="muted small review-progress">
                  {pending.length} pending · center card is active
                </p>
                <div className="carousel-viewport">
                  <div className="carousel-track">
                    <div className="carousel-side left" aria-hidden={leftPeeks.length === 0}>
                      {leftPeeks.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`carousel-peek swipe-card peek-left depth-${leftPeeks.length - i}`}
                          disabled={busy}
                          onClick={() => selectContact(c.id)}
                        >
                          <ContactPeek contact={c} />
                        </button>
                      ))}
                    </div>

                    <div className="carousel-center">
                      {exiting && (
                        <article
                          className={`swipe-card carousel-exiting ${swipeDir === 'left' ? 'exit-left' : 'exit-right'}`}
                          aria-hidden
                        >
                          <ContactDetail contact={exiting} />
                        </article>
                      )}
                      <article
                        className={`swipe-card carousel-active ${dragging ? 'dragging' : ''}`}
                        style={dragStyle}
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                      >
                        {dragX > 40 && <span className="swipe-stamp keep">Keep</span>}
                        {dragX < -40 && !orientLockDiscard && (
                          <span className="swipe-stamp discard">Discard</span>
                        )}
                        <ContactDetail contact={current} />
                      </article>
                    </div>

                    <div className="carousel-side right" aria-hidden={rightPeeks.length === 0}>
                      {rightPeeks.map((c, i) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`carousel-peek swipe-card peek-right depth-${i + 1}`}
                          disabled={busy}
                          onClick={() => selectContact(c.id)}
                        >
                          <ContactPeek contact={c} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="swipe-actions">
                  <button
                    type="button"
                    className="btn swipe-discard"
                    disabled={busy || orientLockDiscard}
                    title={
                      orientLockDiscard
                        ? 'Discard unlocks after orientation'
                        : undefined
                    }
                    onClick={() => openDiscard()}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="btn primary swipe-keep"
                    disabled={busy}
                    onClick={openKeep}
                  >
                    Keep
                  </button>
                </div>

                {!orientLockDiscard && (
                  <div className="company-actions">
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={
                        busy ||
                        current.companies?.user_flag === 'favorite'
                      }
                      onClick={() => applyFavoriteCompany()}
                    >
                      {current.companies?.user_flag === 'favorite'
                        ? 'Company favorited'
                        : 'Favorite company'}
                    </button>
                    <button
                      type="button"
                      className="btn ghost small company-discard-all"
                      disabled={busy || pendingAtCompany < 1}
                      onClick={() => setDiscardCompanyOpen(true)}
                    >
                      Discard all at company ({pendingAtCompany})
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {pending.length > 0 && (
            <section className="review-deck-list" aria-label="All pending contacts">
              <h2>All pending</h2>
              <p className="muted small">
                Click a card to review it in the carousel above.
              </p>
              <div className="contact-grid">
                {pending.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`contact-card selectable ${r.id === current?.id ? 'highlighted' : ''}`}
                    onClick={() => selectContact(r.id)}
                    disabled={busy}
                  >
                    <ContactDetail contact={r} />
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'kept' && (
        <div>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy || kept.length === 0}
              onClick={() => void draftKept()}
            >
              {busy ? 'Drafting…' : 'Draft emails for kept'}
            </button>
          </div>
          <div className="contact-grid">
            {kept.map((r) => (
              <article key={r.id} className="contact-card">
                <ContactDetail contact={r} />
                <div className="actions contact-manage">
                  {sentOutreachIds.has(r.id) ? (
                    <p className="small outreach-sent-note">
                      ✓ Outreach sent — follow up in Gmail
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!r.email || draftingId === r.id}
                      onClick={() => void draftOne(r.id)}
                    >
                      {draftingId === r.id ? 'Drafting…' : 'Draft email'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => archiveContact(r)}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    className="btn ghost swipe-discard"
                    disabled={busy}
                    onClick={() => openDiscard(r)}
                  >
                    Move to discard
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => setDeleteTarget(r)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {kept.length === 0 && (
            <p className="muted">No kept contacts yet — review the queue first.</p>
          )}
        </div>
      )}

      {tab === 'archived' && (
        <div>
          <p className="muted small">
            Archived contacts are hidden from your active list. Archiving does not
            teach the AI to avoid them.
          </p>
          <div className="contact-grid">
            {archived.map((r) => (
              <article key={r.id} className="contact-card">
                <ContactDetail contact={r} />
                <div className="actions contact-manage">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => setDeleteTarget(r)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          {archived.length === 0 && (
            <p className="muted">No archived contacts yet.</p>
          )}
        </div>
      )}

      {deleteTarget && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !busy && setDeleteTarget(null)}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-title">Delete contact?</h2>
            <p className="muted small">
              Permanently removes{' '}
              <strong>{deleteTarget.full_name || 'this contact'}</strong> and
              their drafts. This does not update AI preferences.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn swipe-discard"
                disabled={busy}
                onClick={() => deleteContact(deleteTarget)}
              >
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {keepOpen && current && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !busy && setKeepOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="keep-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="keep-title">What made this a good fit?</h2>
            <p className="muted small">
              Optional — helps search learn what you want more of.
            </p>
            <div className="reason-grid">
              {KEEP_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`reason-chip keep-chip ${selectedKeepReasons.includes(r.id) ? 'selected' : ''}`}
                  onClick={() => toggleKeepReason(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <label>
              Optional note
              <textarea
                rows={2}
                value={keepNote}
                onChange={(e) => setKeepNote(e.target.value)}
                placeholder="What was especially right about this person?"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setKeepOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => applyDecision('keep', [], '', current)}
              >
                Quick keep
              </button>
              <button
                type="button"
                className="btn primary swipe-keep"
                disabled={busy}
                onClick={() =>
                  applyDecision('keep', selectedKeepReasons, keepNote, current)
                }
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}

      {discardCompanyOpen && current && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !busy && setDiscardCompanyOpen(false)}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="discard-company-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="discard-company-title">Discard whole company?</h2>
            <p className="muted small">
              This discards all <strong>{pendingAtCompany}</strong> pending
              contact(s) at{' '}
              <strong>{current.companies?.name || 'this company'}</strong> and
              marks the company as avoid for future searches.
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setDiscardCompanyOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn swipe-discard"
                disabled={busy}
                onClick={() => applyDiscardAllAtCompany()}
              >
                Discard all {pendingAtCompany}
              </button>
            </div>
          </div>
        </div>
      )}

      {discardOpen && discardSubject && (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => {
            if (!busy) {
              setDiscardOpen(false)
              setDiscardTargetId(null)
            }
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-labelledby="discard-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="discard-title">Why discard?</h2>
            <p className="muted small">
              {discardSubject.review_status === 'kept'
                ? 'Moving a kept contact to discard teaches the model what to avoid.'
                : 'Pick one or more reasons — this updates your likes/dislikes docs so search gets smarter.'}
            </p>
            <div className="reason-grid">
              {DISCARD_REASONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`reason-chip ${selectedReasons.includes(r.id) ? 'selected' : ''}`}
                  onClick={() => toggleReason(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <label>
              Optional note
              <textarea
                rows={2}
                value={discardNote}
                onChange={(e) => setDiscardNote(e.target.value)}
                placeholder="Anything else the AI should know…"
              />
            </label>
            <div className="actions">
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setDiscardOpen(false)
                  setDiscardTargetId(null)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn swipe-discard"
                disabled={
                  busy || (selectedReasons.length === 0 && !discardNote.trim())
                }
                onClick={() =>
                  applyDecision(
                    'discard',
                    selectedReasons,
                    discardNote,
                    discardSubject,
                  )
                }
              >
                Confirm discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
