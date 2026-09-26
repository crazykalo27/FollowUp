import { useMemo, useState } from 'react'
import {
  alignmentPrompts,
  assembleResume,
  confirmMarker,
  TEMPLATES,
  type ContentItem,
  type Resume,
} from './engine.ts'
import { blankResume, ResumeLimitError } from './vault.ts'
import { useVaultApi } from './context.tsx'
import { Confirm, Modal } from './widgets.tsx'

export function ResumesPane({ onOpen }: { onOpen: (id: string) => void }) {
  const api = useVaultApi()
  const [query, setQuery] = useState('')
  const [buildOpen, setBuildOpen] = useState(false)
  const [blankOpen, setBlankOpen] = useState(false)
  const [name, setName] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return api.vault.resumes.filter((resume) => !q || resume.name.toLowerCase().includes(q))
  }, [api.vault.resumes, query])

  function create(resume: Resume) {
    try {
      const stored = api.createResume(resume)
      setError(null)
      onOpen(stored.id)
    } catch (err) {
      if (err instanceof ResumeLimitError) setError(err.message)
      else setError(err instanceof Error ? err.message : 'Could not create that resume.')
    }
  }

  return (
    <div className="resume-pane">
      <button type="button" className="resume-hero" onClick={() => setBuildOpen(true)}>
        <span className="resume-kicker">Primary path</span>
        <strong>Build a resume for a posting</strong>
        <span>Score the library, fill the page, and optionally mirror wording you have already confirmed.</span>
      </button>
      <div className="resume-pane-bar">
        <label className="resume-search">
          <span className="sr-only">Search resumes</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title" />
        </label>
        <button type="button" className="btn" onClick={() => { setName(''); setBlankOpen(true) }}>Blank resume</button>
      </div>
      {message && <p className="flash" role="status">{message}</p>}
      {error && <p className="flash error" role="alert">{error}</p>}
      {api.vault.resumes.length === 0 ? (
        <div className="resume-empty">
          <h2>No resumes yet</h2>
          <p>Build one from a job description, or start a blank page and insert library items yourself.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="resume-empty">
          <h2>No resume titled that</h2>
          <p>Search matches the resume name only.</p>
        </div>
      ) : (
        <ul className="resume-cards">
          {filtered.map((resume) => (
            <li key={resume.id}>
              <article className="resume-card resume-card-wide">
                <button type="button" className="resume-card-main" onClick={() => onOpen(resume.id)}>
                  <strong>{resume.name}</strong>
                  <span className="muted small">
                    {TEMPLATES.find((template) => template.id === resume.templateId)?.name ?? resume.templateId}
                    {' · '}
                    {resume.sections.length} sections
                    {' · '}
                    {new Date(resume.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <div className="resume-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      try {
                        const copy = api.duplicateResume(resume.id)
                        setMessage(`Duplicated “${copy.name}”.`)
                        setError(null)
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Could not duplicate.')
                      }
                    }}
                  >
                    Duplicate
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setDeleteId(resume.id)}>Delete</button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      {blankOpen && (
        <Modal title="Blank resume" onClose={() => setBlankOpen(false)}>
          <label className="resume-field">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled resume" />
          </label>
          <div className="resume-actions">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                create(blankResume(name))
                setBlankOpen(false)
              }}
            >
              Create
            </button>
          </div>
        </Modal>
      )}
      {buildOpen && (
        <BuildDialog
          items={api.vault.items}
          onClose={() => setBuildOpen(false)}
          onApplyItems={api.replaceItems}
          onCreate={(resume, warnings) => {
            create(resume)
            setBuildOpen(false)
            if (warnings.length) setMessage(warnings.join(' '))
          }}
        />
      )}
      {deleteId && (
        <Confirm
          title="Delete resume"
          body="The library stays. This page is removed."
          confirmLabel="Delete"
          onClose={() => setDeleteId(null)}
          onConfirm={() => {
            api.deleteResume(deleteId)
            setDeleteId(null)
            setMessage('Resume deleted.')
          }}
        />
      )}
    </div>
  )
}

export function BuildDialog({
  items,
  onClose,
  onApplyItems,
  onCreate,
  initialJob = '',
  initialPages = 1,
  initialName = '',
  hideName = false,
}: {
  items: ContentItem[]
  onClose: () => void
  onApplyItems: (items: ContentItem[]) => void
  onCreate: (resume: Resume, warnings: string[]) => void
  initialJob?: string
  initialPages?: number
  initialName?: string
  hideName?: boolean
}) {
  const [jd, setJd] = useState(initialJob)
  const [pages, setPages] = useState(initialPages)
  const [templateId, setTemplateId] = useState('professional')
  const [align, setAlign] = useState(true)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [prompts, setPrompts] = useState<{ marker: string; question: string }[]>([])
  const [declined, setDeclined] = useState<string[]>([])
  const [library, setLibrary] = useState(items)

  function build(nextLibrary: ContentItem[], nextDeclined: string[]) {
    if (nextLibrary.filter((item) => item.priority !== 'ignore').length === 0) {
      setError('Add something to the library first. Ignored items are skipped.')
      return
    }
    const outcome = assembleResume({
      items: nextLibrary,
      jobDescription: jd,
      templateId,
      targetPages: pages,
      name: name || 'Tailored resume',
      align,
      declinedMarkers: nextDeclined,
    })
    onCreate(outcome.resume, outcome.warnings)
  }

  function start() {
    if (!jd.trim()) {
      setError('Paste a job description to tailor. A blank resume is available from the list.')
      return
    }
    setError(null)
    if (!align) {
      build(library, declined)
      return
    }
    const pending = alignmentPrompts(library, jd).filter((prompt) => !declined.includes(prompt.marker))
    if (pending.length === 0) build(library, declined)
    else setPrompts(pending)
  }

  function answer(marker: string, yes: boolean) {
    const nextDeclined = yes ? declined : [...declined, marker]
    const nextLibrary = yes ? confirmMarker(library, marker) : library
    const rest = prompts.filter((prompt) => prompt.marker !== marker)
    setDeclined(nextDeclined)
    setLibrary(nextLibrary)
    if (yes) onApplyItems(nextLibrary)
    setPrompts(rest)
    if (rest.length === 0) build(nextLibrary, nextDeclined)
  }

  return (
    <Modal title="Build from a posting" onClose={onClose}>
      {prompts.length > 0 ? (
        <div>
          <p>{prompts[0]?.question}</p>
          <p className="muted small">Yes stores the phrase in private notes and may mirror it. No leaves the bullet alone.</p>
          <div className="resume-actions">
            <button type="button" className="btn primary" onClick={() => answer(prompts[0].marker, true)}>Yes, I did this</button>
            <button type="button" className="btn" onClick={() => answer(prompts[0].marker, false)}>No</button>
            <button type="button" className="btn ghost" onClick={() => {
              const rest = prompts.map((prompt) => prompt.marker)
              const nextDeclined = [...declined, ...rest]
              setPrompts([])
              setDeclined(nextDeclined)
              build(library, nextDeclined)
            }}>Skip the rest</button>
          </div>
        </div>
      ) : (
        <>
          {!hideName && (
            <label className="resume-field">
              Resume name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tailored resume" />
            </label>
          )}
          <label className="resume-field">
            Job description
            <textarea rows={8} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the posting" />
          </label>
          <div className="resume-split">
            <label className="resume-field">
              Pages
              <input type="number" min={1} max={4} value={pages} onChange={(e) => setPages(Number(e.target.value) || 1)} />
            </label>
            <label className="resume-field">
              Template
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          </div>
          <label className="resume-check-line">
            <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} />
            Align wording when your notes already support a posting phrase
          </label>
          {library.length === 0 && <p className="flash error">The library is empty, so a tailored resume would have no entries.</p>}
          {error && <p className="flash error" role="alert">{error}</p>}
          <div className="resume-actions">
            <button type="button" className="btn primary" onClick={start}>Build</button>
          </div>
        </>
      )}
    </Modal>
  )
}
