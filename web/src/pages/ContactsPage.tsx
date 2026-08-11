import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import { useOrientation } from '../lib/orientationContext'
import {
  isNewerIso,
  loadContactsReviewPosition,
  newestContactCreatedAt,
  saveContactsReviewPosition,
} from '../lib/contactsReviewPosition'
import {
  looksLikeLocationString,
  parseLocationFromLinkedInSnippet,
} from '../lib/linkedin_location'
import { buildEmailProvenance } from '../lib/emailProvenance'

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
  location: string | null
  sources: string[] | null
  review_status: string | null
  created_at?: string | null
  source_details: {
    hiring_signal?: string
    hiring_signal_url?: string
    job_source?: string
    location?: string
    job_description?: string
    email_provenance?: {
      method?: 'found' | 'guessed'
      origin?: string
      pattern?: string | null
      verification?: 'verified' | 'likely' | 'unverified' | 'unknown'
      verification_status?: string | null
      label?: string
      detail?: string
    }
    hunter_email?: { via?: string; domain?: string }
    pattern?: { inferred?: string | null; candidates?: string[] }
    application?: {
      company?: string
      job_title?: string
      job_description?: string
      location?: string
      projects?: string[]
      responsibilities?: string[]
    }
    websearch?: { location?: string; snippet?: string }
  } | null
  application_context?: {
    company?: string
    job_title?: string
    job_description?: string
    location?: string
    projects?: string[]
    responsibilities?: string[]
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
  { id: 'not_a_person', label: 'Not a person' },
  { id: 'wrong_industry', label: 'Wrong industry' },
  { id: 'not_hiring_connected', label: 'Not someone connected to hiring' },
  { id: 'wrong_location', label: 'Wrong location' },
  { id: 'wrong_job_type', label: 'Wrong job type' },
  { id: 'not_interested_anymore', label: 'Not interested anymore' },
] as const

const KEEP_REASONS = [
  { id: 'great_location', label: 'Great location' },
  { id: 'great_hiring_connection', label: 'Great hiring connection' },
  { id: 'great_application_connection', label: 'Great application connection' },
  { id: 'great_industry_match', label: 'Great industry match' },
  { id: 'great_job_type_match', label: 'Great job type match' },
] as const

function contactSources(r: ContactRow) {
  return r.sources?.length
    ? r.sources
    : r.discovery_source
      ? [r.discovery_source]
      : []
}

/** Person-discovery pills — hide email-pipeline tags (shown under Email). */
function personDiscoverySources(r: ContactRow): string[] {
  const emailOnly = new Set([
    'pattern',
    'verify_mx',
    'site_crawl',
    'web_snippet',
    'osint_worker',
    'osint',
  ])
  return contactSources(r).filter((s) => !emailOnly.has(s))
}

function formatSourceLabel(source: string) {
  const labels: Record<string, string> = {
    hunter: 'Hunter.io',
    apollo: 'Apollo.io',
    websearch: 'Web search',
    site_crawl: 'Company site',
    pattern: 'Email pattern',
    verify_mx: 'MX verified',
    osint: 'OSINT',
    osint_worker: 'OSINT',
    web_snippet: 'Web email',
  }
  return labels[source] || source.replace(/_/g, ' ')
}

function contactLocation(contact: ContactRow): string | null {
  const stored = contact.location?.trim()
  if (stored && looksLikeLocationString(stored)) return stored
  const sd = contact.source_details
  if (!sd) return stored || null
  if (typeof sd.location === 'string' && sd.location.trim()) {
    const fromSd = sd.location.trim()
    if (looksLikeLocationString(fromSd)) return fromSd
  }
  const wsLoc = sd.websearch?.location
  if (typeof wsLoc === 'string' && wsLoc.trim()) {
    const fromWs = wsLoc.trim()
    if (looksLikeLocationString(fromWs)) return fromWs
  }
  const snippet = sd.websearch?.snippet
  if (typeof snippet === 'string') {
    return parseLocationFromLinkedInSnippet(snippet)
  }
  return null
}

function ContactDetail({
  contact,
  compact = false,
}: {
  contact: ContactRow
  compact?: boolean
}) {
  const hiring =
    contact.source_details?.hiring_signal ||
    contact.companies?.hiring_signal_title ||
    null
  const hiringUrl =
    contact.source_details?.hiring_signal_url ||
    contact.companies?.hiring_signal_url ||
    null
  const appCtx =
    contact.application_context || contact.source_details?.application || null
  const appliedRole =
    appCtx?.job_description ||
    contact.source_details?.job_description ||
    appCtx?.job_title ||
    null
  const sources = personDiscoverySources(contact)
  const companyName = contact.companies?.name || '—'
  const companyDomain = contact.companies?.domain
  const location = contactLocation(contact)
  const emailProvenance = contact.email
    ? buildEmailProvenance({
        sources: contact.sources,
        verification_status: contact.verification_status,
        source_details: contact.source_details as Record<string, unknown> | null,
      })
    : null

  return (
    <div
      className={`contact-detail${compact ? ' contact-detail-compact' : ''}`}
    >
      <header className="contact-detail-header">
        <h2 className="contact-detail-name">
          {contact.full_name || 'Unknown'}
        </h2>
        {sources.length > 0 && (
          <div className="source-pills contact-detail-sources">
            {sources.map((s) => (
              <span key={s} className={`pill source-${s}`} title="Person found via">
                {formatSourceLabel(s)}
              </span>
            ))}
          </div>
        )}
      </header>

      <dl className="contact-detail-grid">
        <dt>Role</dt>
        <dd className="contact-detail-role">
          {contact.title || 'Title unknown'}
        </dd>

        <dt>Company</dt>
        <dd>
          <span className="company-line">
            <span>{companyName}</span>
            {companyDomain && (
              <span className="muted small"> · {companyDomain}</span>
            )}
            {contact.companies?.user_flag === 'favorite' && (
              <span className="pill company-favorite">Favorite</span>
            )}
            {contact.companies?.user_flag === 'avoid' && (
              <span className="pill company-avoid">Avoid</span>
            )}
          </span>
        </dd>

        <dt>Location</dt>
        <dd>{location || '—'}</dd>

        <dt>Email</dt>
        <dd>
          <div className="contact-detail-email">
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                onClick={(e) => e.stopPropagation()}
              >
                {contact.email}
              </a>
            ) : (
              '—'
            )}
          </div>
          {emailProvenance && (
            <div
              className={`contact-email-provenance method-${emailProvenance.method} verify-${emailProvenance.verification}`}
            >
              <span
                className={`pill email-method email-method-${emailProvenance.method}`}
                title={emailProvenance.detail}
              >
                {emailProvenance.method === 'guessed' ? 'Guessed' : 'Found'}
              </span>
              <span className="muted small contact-detail-verify">
                {emailProvenance.detail}
              </span>
            </div>
          )}
        </dd>

        <dt>LinkedIn</dt>
        <dd>
          {contact.linkedin_url ? (
            <a
              href={contact.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="contact-detail-link"
              onClick={(e) => e.stopPropagation()}
            >
              View profile
            </a>
          ) : (
            '—'
          )}
        </dd>

        {appliedRole && (
          <>
            <dt>Applied role</dt>
            <dd className="contact-detail-signal">{appliedRole}</dd>
          </>
        )}

        {hiring && (
          <>
            <dt>Hiring signal</dt>
            <dd className="contact-detail-signal">
              {hiringUrl ? (
                <a
                  href={hiringUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {hiring}
                </a>
              ) : (
                hiring
              )}
            </dd>
          </>
        )}
      </dl>

      {contact.filter_match_reason && (
        <div className="contact-detail-why">
          <span className="contact-detail-why-label">Why we surfaced them</span>
          <p>{contact.filter_match_reason}</p>
        </div>
      )}
    </div>
  )
}

export function ContactsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const orientation = useOrientation()
  const calibrationReview = !orientation.complete && orientation.step === 'contacts'
  const secondPassReview =
    !orientation.complete && orientation.step === 'contacts2'
  const pickKeptForDraft =
    !orientation.complete && orientation.step === 'drafts'
  const requireKeepReasons = calibrationReview || secondPassReview
  const [rows, setRows] = useState<ContactRow[]>([])
  const [busy, setBusy] = useState(false)
  const [refining, setRefining] = useState(false)
  const refineStarted = useRef(false)
  const secondPassDone = useRef(false)
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
  const [draftedContactIds, setDraftedContactIds] = useState<Set<string>>(
    () => new Set(),
  )
  const positionReady = useRef(false)
  const skipPersistOnce = useRef(false)

  const load = useCallback(async () => {
    if (!user) return
    const [{ data }, { data: draftRows }] = await Promise.all([
      supabase
        .from('contacts')
        .select(
          'id, company_id, full_name, title, email, location, verification_status, filter_match_reason, discovery_source, linkedin_url, sources, review_status, created_at, source_details, application_context, companies(id, name, domain, hiring_signal_title, hiring_signal_url, user_flag)',
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('outreach_drafts')
        .select('contact_id, status')
        .eq('user_id', user.id),
    ])
    const drafted = new Set<string>()
    const sent = new Set<string>()
    for (const row of draftRows || []) {
      const cid = row.contact_id as string
      if (row.status === 'sent' || row.status === 'pending') {
        drafted.add(cid)
        if (row.status === 'sent') sent.add(cid)
      }
    }
    setDraftedContactIds(drafted)
    setSentOutreachIds(sent)
    const mapped = (data || []).map((r) => ({
      ...r,
      companies: Array.isArray(r.companies) ? r.companies[0] : r.companies,
    })) as ContactRow[]
    setRows(mapped)

    const pendingRows = mapped.filter(
      (r) => (r.review_status || 'pending') === 'pending',
    )
    const newestCreatedAt = newestContactCreatedAt(mapped)

    const stored = loadContactsReviewPosition(user.id)
    const hasNewContacts = isNewerIso(
      newestCreatedAt,
      stored?.newestCreatedAt ?? null,
    )

    skipPersistOnce.current = true
    if (pendingRows.length === 0) {
      setActiveId(null)
    } else if (hasNewContacts) {
      // Fresh search results — start on the most recent new pending contact
      setActiveId(pendingRows[0].id)
    } else if (
      stored?.activeId &&
      pendingRows.some((p) => p.id === stored.activeId)
    ) {
      setActiveId(stored.activeId)
    } else {
      setActiveId(pendingRows[0].id)
    }

    saveContactsReviewPosition(user.id, {
      activeId:
        hasNewContacts
          ? pendingRows[0]?.id || null
          : stored?.activeId && pendingRows.some((p) => p.id === stored.activeId)
            ? stored.activeId
            : pendingRows[0]?.id || null,
      newestCreatedAt,
    })
    positionReady.current = true
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
  /** Hide Kept/Archived while a full keep/discard queue is still in progress. */
  const reviewingQueue =
    calibrationReview || (secondPassReview && pending.length > 0)
  const showKeptPicker = pickKeptForDraft || (secondPassReview && pending.length === 0)

  const newestCreatedAt = useMemo(
    () => newestContactCreatedAt(rows),
    [rows],
  )

  // Keep activeId valid; do not reset to first when a saved id is still pending
  useEffect(() => {
    if (pending.length === 0) {
      if (activeId !== null) setActiveId(null)
      return
    }
    if (!activeId || !pending.some((p) => p.id === activeId)) {
      setActiveId(pending[0].id)
    }
  }, [pending, activeId])

  // Persist last-reviewed contact while navigating around the app
  useEffect(() => {
    if (!user || !positionReady.current) return
    if (skipPersistOnce.current) {
      skipPersistOnce.current = false
      return
    }
    saveContactsReviewPosition(user.id, {
      activeId,
      newestCreatedAt,
    })
  }, [user, activeId, newestCreatedAt])

  const current = useMemo(
    () => pending.find((p) => p.id === activeId) || pending[0] || null,
    [pending, activeId],
  )

  const currentIndex = useMemo(() => {
    if (!current) return -1
    return pending.findIndex((p) => p.id === current.id)
  }, [pending, current])

  const prevContact = useMemo(() => {
    if (currentIndex <= 0) return null
    return pending[currentIndex - 1] ?? null
  }, [pending, currentIndex])

  const nextContact = useMemo(() => {
    if (currentIndex < 0 || currentIndex >= pending.length - 1) return null
    return pending[currentIndex + 1] ?? null
  }, [pending, currentIndex])

  const pendingAtCompany = useMemo(() => {
    if (!current?.company_id) return 0
    return pending.filter((p) => p.company_id === current.company_id).length
  }, [pending, current])

  function enqueueReviewChain(
    task: () => Promise<void>,
    onError: (e: unknown) => void,
  ) {
    setSyncPending((n) => n + 1)
    reviewChainRef.current = reviewChainRef.current
      .then(task)
      .catch(onError)
      .finally(() => {
        setSyncPending((n) => Math.max(0, n - 1))
      })
  }

  function enqueueCompanyAction(
    company_action: 'discard_all' | 'favorite',
    contact_id: string,
    rollback: () => void,
  ) {
    enqueueReviewChain(
      async () => {
        await invokeFunction<{
          contacts_discarded?: number
          pending_remaining: number
        }>('review-contact', {
          contact_id,
          company_action,
        })
      },
      (e) => {
        rollback()
        setMsg(
          e instanceof Error
            ? `Could not save — ${e.message}`
            : 'Could not save company action.',
        )
      },
    )
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
    enqueueReviewChain(
      async () => {
        await invokeFunction<{
          pending_remaining: number
          preference_summary?: string | null
        }>('review-contact', {
          contact_id: payload.contact_id,
          decision: payload.decision,
          reasons: payload.reasons,
          note: payload.note || undefined,
        })
      },
      (e) => {
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
      },
    )
  }

  function enqueueContactAction(
    action: 'archive' | 'delete',
    contactId: string,
    snapshot: ContactRow,
  ) {
    enqueueReviewChain(
      async () => {
        await invokeFunction('review-contact', {
          contact_id: contactId,
          action,
        })
      },
      (e) => {
        if (action === 'delete') {
          setRows((prev) => [...prev, snapshot])
        } else {
          setRows((prev) =>
            prev.map((r) =>
              r.id === contactId
                ? { ...r, review_status: snapshot.review_status }
                : r,
            ),
          )
        }
        setMsg(
          e instanceof Error ? e.message : 'Could not complete that action.',
        )
      },
    )
  }

  function applyDecision(
    decision: 'keep' | 'discard',
    reasons: string[] = [],
    note = '',
    target?: ContactRow,
  ) {
    const subject = target || current
    if (!subject || busy || refining) return

    if (decision === 'discard' && reasons.length === 0 && !note.trim()) {
      return
    }

    if (
      decision === 'keep' &&
      requireKeepReasons &&
      reasons.length === 0 &&
      !note.trim()
    ) {
      setMsg('Pick at least one reason for this pick.')
      setKeepOpen(true)
      return
    }

    const deciding = subject
    const decidingId = deciding.id
    const isReviewQueue = (deciding.review_status || 'pending') === 'pending'
    const remainingPending = isReviewQueue
      ? pending.filter((p) => p.id !== decidingId)
      : pending
    const nextId = remainingPending[0]?.id || null
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

  async function runCalibrationRefine() {
    if (refineStarted.current || refining) return
    refineStarted.current = true
    setRefining(true)
    setMsg('Updating your industry targets from this feedback…')
    try {
      const res = await invokeFunction<{
        steps?: string[]
        industries?: string[]
      }>('refine-targets', {})
      await orientation.advanceTo('refine')
      setMsg(
        res.industries?.length
          ? `Refined niches: ${res.industries.slice(0, 3).join(', ')}…`
          : 'Targets refined.',
      )
      navigate('/app/refine')
    } catch (e) {
      refineStarted.current = false
      setMsg(
        e instanceof Error
          ? e.message
          : 'Could not refine targets — try again from Refine.',
      )
    } finally {
      setRefining(false)
    }
  }

  // After all calibration contacts are reviewed, run gradient refine
  useEffect(() => {
    if (!calibrationReview || refining || busy) return
    if (rows.length === 0) return
    if (pending.length > 0) return
    const reviewed = rows.filter(
      (r) => r.review_status === 'kept' || r.review_status === 'discarded',
    )
    if (reviewed.length === 0) return
    void runCalibrationRefine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calibrationReview, pending.length, rows, busy, refining])

  // After second-pass review of everyone, open Kept so they can draft one
  useEffect(() => {
    if (!secondPassReview || busy || secondPassDone.current) return
    if (rows.length === 0) return
    if (pending.length > 0) return
    const reviewed = rows.filter(
      (r) => r.review_status === 'kept' || r.review_status === 'discarded',
    )
    if (reviewed.length === 0) return
    secondPassDone.current = true
    setTab('kept')
    setMsg(
      kept.length > 0
        ? null
        : 'You discarded everyone this round — keep at least one person next time, or draft from an earlier Kept contact if you have one.',
    )
    void orientation.advanceTo('drafts')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondPassReview, pending.length, rows, busy, kept.length])

  // Orientation drafts step: land on Kept to pick someone
  useEffect(() => {
    if (!pickKeptForDraft) return
    setTab('kept')
  }, [pickKeptForDraft])

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
    const dx = e.clientX - dragStart.current.x
    setDragX(dx)
  }

  function onPointerUp() {
    if (!dragging) return
    setDragging(false)
    dragStart.current = null
    if (dragX > 110) {
      if (requireKeepReasons) {
        openKeep()
        setDragX(0)
      } else {
        applyDecision('keep')
      }
    } else if (dragX < -110) {
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
      setDraftedContactIds((prev) => new Set(prev).add(id))
      if (pickKeptForDraft) {
        setMsg('Draft ready — opening outbox…')
        navigate(`/app/drafts?contact=${id}`)
      } else {
        setMsg('Draft ready — press Go to drafts to review it.')
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Drafting failed')
    } finally {
      setDraftingId(null)
    }
  }

  function goToDraft(contactId: string) {
    navigate(`/app/drafts?contact=${contactId}`)
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

  const dragStyle = swipeDir
    ? undefined
    : {
        transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)`,
        transition: dragging ? 'none' : 'transform 0.2s ease',
      }

  return (
    <div className="panel">
      <h1>Contacts</h1>
      <p className="lede">
        {calibrationReview
          ? `Review every person from the calibration search (${pending.length} remaining). Keep or discard each with a reason — that feedback steers your industries.`
          : secondPassReview
            ? `Review every person from the refined search (${pending.length} remaining). Keep or discard each with a reason — then pick someone from Kept to draft.`
            : pickKeptForDraft
              ? 'Almost done — pick someone from Kept and press Draft email on their card to open the outbox.'
              : 'Swipe or use Keep / Discard on the center card. Click the card to the left or right to jump to that contact.'}
      </p>

      {calibrationReview && (
        <div className="orientation-coach">
          <p className="muted small">
            Reasons are required. When the queue is empty we run a preference
            gradient update (~10% exploration), then a second search.
          </p>
          {refining && (
            <p className="muted small">Refining your industry targets…</p>
          )}
        </div>
      )}

      {secondPassReview && (
        <div className="orientation-coach">
          <p className="muted small">
            When you finish, we open Kept so you can draft outreach to one
            person.
          </p>
        </div>
      )}

      <div className="tab-row">
        {!pickKeptForDraft && (
          <button
            type="button"
            className={`tab ${tab === 'review' ? 'active' : ''}`}
            onClick={() => setTab('review')}
          >
            Review ({pending.length})
          </button>
        )}
        {!reviewingQueue && (
          <>
            <button
              type="button"
              className={`tab ${tab === 'kept' ? 'active' : ''}`}
              onClick={() => setTab('kept')}
            >
              Kept ({kept.length})
            </button>
            {!showKeptPicker && (
              <button
                type="button"
                className={`tab ${tab === 'archived' ? 'active' : ''}`}
                onClick={() => setTab('archived')}
              >
                Archived ({archived.length})
              </button>
            )}
            {!showKeptPicker && (
              <Link className="btn" to="/app/drafts">
                Open drafts
              </Link>
            )}
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
                  <div
                    className="carousel-stage"
                    aria-label="Swipe review — center card active"
                  >
                    {prevContact && (
                      <button
                        key={prevContact.id}
                        type="button"
                        className="swipe-card carousel-peek peek-left"
                        disabled={busy}
                        aria-label={`Previous: ${prevContact.full_name || 'contact'}`}
                        onClick={() => selectContact(prevContact.id)}
                      >
                        <ContactDetail contact={prevContact} compact />
                      </button>
                    )}
                    {nextContact && (
                      <button
                        key={nextContact.id}
                        type="button"
                        className="swipe-card carousel-peek peek-right"
                        disabled={busy}
                        aria-label={`Next: ${nextContact.full_name || 'contact'}`}
                        onClick={() => selectContact(nextContact.id)}
                      >
                        <ContactDetail contact={nextContact} compact />
                      </button>
                    )}
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
                        {dragX < -40 && (
                          <span className="swipe-stamp discard">Discard</span>
                        )}
                        <ContactDetail contact={current} />
                      </article>
                    </div>
                  </div>
                </div>

                <div className="swipe-actions">
                  <button
                    type="button"
                    className="btn swipe-discard"
                    disabled={busy || refining}
                    onClick={() => openDiscard()}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="btn primary swipe-keep"
                    disabled={busy || refining}
                    onClick={openKeep}
                  >
                    Keep
                  </button>
                </div>

                <div className="company-actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={
                      busy ||
                      refining ||
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
                    disabled={busy || refining || pendingAtCompany < 1}
                    onClick={() => setDiscardCompanyOpen(true)}
                  >
                    Discard all at company ({pendingAtCompany})
                  </button>
                </div>
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
          {!pickKeptForDraft && (
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
          )}
          <div className="contact-grid">
            {kept.map((r) => (
              <article key={r.id} className="contact-card">
                <ContactDetail contact={r} />
                <div className="actions contact-manage">
                  {sentOutreachIds.has(r.id) ? (
                    <p className="small outreach-sent-note">
                      ✓ Outreach sent — follow up in Gmail
                    </p>
                  ) : draftedContactIds.has(r.id) ? (
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => goToDraft(r.id)}
                    >
                      Go to drafts
                    </button>
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
                  {!pickKeptForDraft && (
                    <>
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
                    </>
                  )}
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
            <h2 id="keep-title">What was right about this pick?</h2>
            <p className="muted small">
              {requireKeepReasons
                ? 'Required during calibration — we learn from the hiring signal that led here.'
                : 'Optional — we learn from the hiring signal that led to this contact, not just the person.'}
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
                placeholder='e.g. "great embedded automotive fit"'
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
              {!requireKeepReasons && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => applyDecision('keep', [], '', current)}
                >
                  Quick keep
                </button>
              )}
              <button
                type="button"
                className="btn primary swipe-keep"
                disabled={
                  busy ||
                  (requireKeepReasons &&
                    selectedKeepReasons.length === 0 &&
                    !keepNote.trim())
                }
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
            <h2 id="discard-title">Why discard this pick?</h2>
            <p className="muted small">
              We attach your feedback to the hiring signal / match reason that
              produced this contact, so search learns which pick types to avoid.
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
              Why this niche is wrong (optional note)
              <textarea
                rows={2}
                value={discardNote}
                onChange={(e) => setDiscardNote(e.target.value)}
                placeholder='e.g. "fusion not embedded automotive" (reject … not … want)'
              />
            </label>
            <p className="muted small" style={{ marginTop: '0.35rem' }}>
              Use “X not Y” so we know X is wrong and Y is what you want.
            </p>
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
