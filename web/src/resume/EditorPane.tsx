import { useEffect, useRef, useState } from 'react'
import { buildDocx } from './docx.ts'
import {
  addBullet,
  addEntry,
  addSection,
  duplicateEntry,
  moveEntry,
  moveSection,
  removeBullet,
  removeEntry,
  removeSection,
  renameResume,
  renameSection,
  SECTION_CHOICES,
  setBulletStyle,
  setJobDescription,
  setTemplate,
  setTheme,
  writeField,
} from './edit.ts'
import {
  bulletGlyph,
  contentTypeLabel,
  critiqueResume,
  dateRangeLabel,
  displayField,
  itemSearchText,
  resolveEntry,
  TEMPLATES,
  THEME_PRESETS,
  visibleBullets,
  type BulletStyle,
  type ContentItem,
  type ContentType,
  type Resume,
  type ResumeTheme,
} from './engine.ts'
import { BuildDialog } from './ResumesPane.tsx'
import { useVaultApi } from './context.tsx'
import { Modal } from './widgets.tsx'

const SECTION_FOR: Record<ContentType, { type: string; title: string }> = {
  header: { type: 'header', title: 'Header' },
  experience: { type: 'work_experience', title: 'Experience' },
  education: { type: 'education', title: 'Education' },
  project: { type: 'projects', title: 'Projects' },
  skills: { type: 'skills', title: 'Skills' },
  certification: { type: 'certifications', title: 'Certifications' },
  award: { type: 'awards', title: 'Awards' },
  volunteer: { type: 'volunteer_experience', title: 'Volunteer' },
  leadership: { type: 'leadership', title: 'Leadership' },
  extracurricular: { type: 'leadership', title: 'Leadership' },
  custom: { type: 'custom', title: 'Highlights' },
}

export function EditorPane({ resumeId, onBack }: { resumeId: string; onBack: () => void }) {
  const api = useVaultApi()
  const saved = api.vault.resumes.find((resume) => resume.id === resumeId)
  if (!saved) {
    return (
      <div className="resume-empty">
        <h2>This resume is missing</h2>
        <p>It may have been deleted on this device.</p>
        <button type="button" className="btn" onClick={onBack}>Back to resumes</button>
      </div>
    )
  }
  return (
    <EditorBody
      key={saved.id}
      initial={saved}
      items={api.vault.items}
      onSave={api.updateResume}
      onReplaceItems={api.replaceItems}
      onBack={onBack}
    />
  )
}

function EditorBody({
  initial,
  items,
  onSave,
  onReplaceItems,
  onBack,
}: {
  initial: Resume
  items: ContentItem[]
  onSave: (resume: Resume) => void
  onReplaceItems: (items: ContentItem[]) => void
  onBack: () => void
}) {
  const [history, setHistory] = useState({ past: [] as Resume[], present: initial, future: [] as Resume[] })
  const resume = history.present
  const [tab, setTab] = useState<'library' | 'outline' | 'job' | 'stats'>('library')
  const [inspector, setInspector] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [scoreOpen, setScoreOpen] = useState(false)
  const [tailorOpen, setTailorOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState<{ top: number; left: number } | null>(null)
  const skipSave = useRef(true)
  const saveRef = useRef(onSave)
  saveRef.current = onSave

  function commitFrom(current: Resume, next: Resume) {
    if (next === current) return
    setHistory((h) => ({ past: [...h.past, h.present].slice(-80), present: next, future: [] }))
  }

  function paint(next: Resume) {
    setHistory((h) => ({ ...h, present: next }))
  }

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    const timer = window.setTimeout(() => saveRef.current(resume), 400)
    return () => window.clearTimeout(timer)
  }, [resume])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey
      if (!meta || event.key.toLowerCase() !== 'z') return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function undo() {
    setHistory((h) => {
      if (h.past.length === 0) return h
      const previous = h.past[h.past.length - 1]
      return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] }
    })
  }

  function redo() {
    setHistory((h) => {
      if (h.future.length === 0) return h
      const [next, ...rest] = h.future
      return { past: [...h.past, h.present], present: next, future: rest }
    })
  }

  function onField(entryId: string, key: string, plain: string, html: string) {
    let next = writeField(resume, entryId, key, plain, html)
    if (key.startsWith('bullet:')) {
      const bulletId = key.slice('bullet:'.length)
      next = {
        ...next,
        alignmentHighlightBulletIds: (next.alignmentHighlightBulletIds ?? []).filter((id) => id !== bulletId),
      }
    }
    commitFrom(resume, next)
  }

  const theme = resume.theme ?? {}
  const highlights = new Set(resume.alignmentHighlightBulletIds ?? [])

  return (
    <div className="resume-editor">
      <header className="resume-editor-bar">
        <button type="button" className="btn btn-sm" onClick={onBack}>Back</button>
        <input
          className="resume-name"
          aria-label="Resume name"
          value={resume.name}
          onChange={(e) => commitFrom(resume, renameResume(resume, e.target.value))}
        />
        <select
          aria-label="Template"
          value={resume.templateId}
          onChange={(e) => commitFrom(resume, setTemplate(resume, e.target.value))}
        >
          {TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <button type="button" className="btn btn-sm" onClick={undo} disabled={history.past.length === 0}>Undo</button>
        <button type="button" className="btn btn-sm" onClick={redo} disabled={history.future.length === 0}>Redo</button>
        <button type="button" className="btn btn-sm" onClick={() => setInspector((open) => !open)}>Style</button>
        <button type="button" className="btn btn-sm" onClick={() => setScoreOpen(true)}>Score</button>
        <button type="button" className="btn btn-sm" onClick={() => setExportOpen(true)}>Export</button>
      </header>
      {error && <p className="flash error" role="alert">{error}</p>}
      {notice && <p className="flash" role="status">{notice}</p>}
      <div className="resume-editor-grid">
        <aside className="resume-side">
          <div className="resume-tabs" role="tablist">
            {(['library', 'outline', 'job', 'stats'] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'resume-tab on' : 'resume-tab'} onClick={() => setTab(id)}>
                {id === 'library' ? 'Library' : id === 'outline' ? 'Outline' : id === 'job' ? 'Job' : 'AI stats'}
              </button>
            ))}
          </div>
          {tab === 'library' && (
            <div>
              <input value={query} aria-label="Filter library" placeholder="Filter library" onChange={(e) => setQuery(e.target.value)} />
              <ul className="resume-mini-list">
                {items.filter((item) => !query || itemSearchText(item).includes(query.toLowerCase())).map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.title || contentTypeLabel(item.type)}</strong>
                      <span className="muted small">{contentTypeLabel(item.type)}</span>
                    </div>
                    <button type="button" className="btn btn-sm" onClick={() => insertItem(item)}>Insert</button>
                  </li>
                ))}
              </ul>
              {items.length === 0 && <p className="muted small">The library is empty. Add items from the Library tab, then come back.</p>}
            </div>
          )}
          {tab === 'outline' && (
            <div>
              <label className="resume-field">
                Add section
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const choice = SECTION_CHOICES.find((row) => row.type === e.target.value)
                    if (!choice) return
                    commitFrom(resume, addSection(resume, choice.type, choice.title))
                    e.target.value = ''
                  }}
                >
                  <option value="">Choose</option>
                  {SECTION_CHOICES.map((choice) => <option key={choice.type} value={choice.type}>{choice.title}</option>)}
                </select>
              </label>
              {resume.sections.length === 0 && <p className="muted small">No sections yet. Insert from the library or add one here.</p>}
              <ul className="resume-mini-list">
                {[...resume.sections].sort((a, b) => a.order - b.order).map((section) => (
                  <li key={section.id}>
                    <input
                      aria-label="Section title"
                      value={section.title}
                      onChange={(e) => commitFrom(resume, renameSection(resume, section.id, e.target.value))}
                    />
                    <div className="resume-inline">
                      <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, moveSection(resume, section.id, -1))}>Up</button>
                      <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, moveSection(resume, section.id, 1))}>Down</button>
                      <select
                        aria-label="Bullet style"
                        value={section.bulletStyle ?? 'disc'}
                        onChange={(e) => commitFrom(resume, setBulletStyle(resume, section.id, e.target.value as BulletStyle))}
                      >
                        {(['disc', 'circle', 'square', 'dash', 'none'] as BulletStyle[]).map((style) => <option key={style} value={style}>{style}</option>)}
                      </select>
                      <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, removeSection(resume, section.id))}>Remove</button>
                    </div>
                    <ul>
                      {[...section.entries].sort((a, b) => a.order - b.order).map((entry) => {
                        const item = items.find((row) => row.id === entry.contentItemId)
                        return (
                          <li key={entry.id}>
                            <button type="button" className={selected === entry.id ? 'resume-link on' : 'resume-link'} onClick={() => setSelected(entry.id)}>
                              {item?.title || 'Missing item'}
                            </button>
                            <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, moveEntry(resume, entry.id, -1))}>Up</button>
                            <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, moveEntry(resume, entry.id, 1))}>Down</button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tab === 'job' && (
            <JobTab
              resume={resume}
              onChange={(jd, pages) => paint(setJobDescription(resume, jd, pages))}
              onTailor={() => setTailorOpen(true)}
            />
          )}
          {tab === 'stats' && <StatsTab resume={resume} />}
        </aside>
        <div className="resume-canvas-scroll" onMouseUp={placeToolbar}>
          {toolbar && (
            <div className="resume-format" style={{ top: toolbar.top, left: toolbar.left }}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('bold')}>Bold</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('italic')}>Italic</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => document.execCommand('removeFormat')}>Clear</button>
            </div>
          )}
          <article
            id="resume-paper"
            className={`resume-paper ${resume.templateId}`}
            style={{
              fontFamily: theme.fontFamily,
              fontSize: theme.fontSizePt ? `${theme.fontSizePt}pt` : undefined,
              color: theme.textColor,
              lineHeight: theme.lineHeight,
            }}
          >
            {resume.sections.length === 0 && (
              <p className="resume-paper-empty">This page is blank. Insert a library item or add a section.</p>
            )}
            {[...resume.sections].sort((a, b) => a.order - b.order).map((section) => (
              <section
                key={section.id}
                className={selected === section.id ? 'resume-block on' : 'resume-block'}
                style={{ marginTop: theme.sectionSpacingPt ? `${theme.sectionSpacingPt}pt` : undefined }}
                onClick={() => setSelected(section.id)}
              >
                {section.type !== 'header' && (
                  <h3 style={{ color: theme.accentColor, borderColor: theme.accentColor }}>{section.title}</h3>
                )}
                {[...section.entries].sort((a, b) => a.order - b.order).map((entry) => {
                  const item = items.find((row) => row.id === entry.contentItemId)
                  if (!item) {
                    return (
                      <p key={entry.id} className="flash error">
                        This entry points at a deleted library item.
                        <button type="button" className="btn btn-sm" onClick={() => commitFrom(resume, removeEntry(resume, entry.id))}>Remove entry</button>
                      </p>
                    )
                  }
                  const resolved = resolveEntry(entry, item)
                  const glyph = bulletGlyph(section.bulletStyle)
                  return (
                    <div
                      key={entry.id}
                      className={selected === entry.id ? 'resume-entry on' : 'resume-entry'}
                      style={{ marginBottom: theme.entrySpacingPt ? `${theme.entrySpacingPt}pt` : undefined }}
                      onClick={(event) => { event.stopPropagation(); setSelected(entry.id) }}
                    >
                      <div className="resume-entry-tools">
                        <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, moveEntry(resume, entry.id, -1))}>Up</button>
                        <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, moveEntry(resume, entry.id, 1))}>Down</button>
                        <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, duplicateEntry(resume, entry.id))}>Duplicate</button>
                        <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, removeEntry(resume, entry.id))}>Remove</button>
                        <button type="button" className="btn ghost btn-sm" onClick={() => commitFrom(resume, addBullet(resume, entry.id))}>Bullet</button>
                      </div>
                      {section.type === 'header' ? (
                        <header className="resume-header-block">
                          <Editable className="resume-person" text={displayField(entry, 'title', resolved.title ?? '')} onCommit={(plain, html) => onField(entry.id, 'title', plain, html)} />
                          <Editable className="resume-role" text={displayField(entry, 'subtitle', resolved.subtitle ?? '')} onCommit={(plain, html) => onField(entry.id, 'subtitle', plain, html)} />
                          <p>{(resolved.contactFields ?? []).map((field) => field.value).filter(Boolean).join(' · ')}</p>
                        </header>
                      ) : (
                        <>
                          <div className="resume-entry-head">
                            <Editable text={displayField(entry, 'title', resolved.title ?? '')} onCommit={(plain, html) => onField(entry.id, 'title', plain, html)} />
                            <span>{dateRangeLabel(resolved)}</span>
                          </div>
                          <Editable text={displayField(entry, 'organization', resolved.organization ?? '')} onCommit={(plain, html) => onField(entry.id, 'organization', plain, html)} />
                          <Editable text={displayField(entry, 'description', resolved.description ?? '')} onCommit={(plain, html) => onField(entry.id, 'description', plain, html)} />
                          {(resolved.skillGroups ?? []).map((group) => (
                            <p key={group.id}><strong>{group.category}: </strong>{group.skills.join(', ')}</p>
                          ))}
                          <ul className="resume-bullets">
                            {visibleBullets(entry, item).map((bullet) => (
                              <li key={bullet.id} className={highlights.has(bullet.id) ? 'jd-row' : undefined}>
                                {glyph && <span className="resume-glyph">{glyph}</span>}
                                {highlights.has(bullet.id) && <span className="jd-mark">JD</span>}
                                <Editable
                                  text={displayField(entry, `bullet:${bullet.id}`, bullet.text)}
                                  onCommit={(plain, html) => onField(entry.id, `bullet:${bullet.id}`, plain, html)}
                                />
                                <button type="button" className="btn ghost btn-sm no-print" onClick={() => commitFrom(resume, removeBullet(resume, entry.id, bullet.id, (item.bullets ?? []).map((row) => row.id)))}>Remove</button>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  )
                })}
              </section>
            ))}
          </article>
        </div>
        {inspector && (
          <StyleSheet
            theme={theme}
            onChange={(next) => commitFrom(resume, setTheme(resume, next))}
            onClose={() => setInspector(false)}
          />
        )}
      </div>
      {exportOpen && (
        <ExportDialog
          resume={resume}
          items={items}
          onClose={() => setExportOpen(false)}
          onError={setError}
        />
      )}
      {scoreOpen && (
        <ScoreDialog resume={resume} items={items} onClose={() => setScoreOpen(false)} />
      )}
      {tailorOpen && (
        <BuildDialog
          items={items}
          initialJob={resume.jobDescription ?? ''}
          initialPages={resume.targetPages ?? 1}
          initialName={resume.name}
          hideName
          onClose={() => setTailorOpen(false)}
          onApplyItems={onReplaceItems}
          onCreate={(built, warnings) => {
            commitFrom(resume, {
              ...built,
              id: resume.id,
              name: resume.name,
              createdAt: resume.createdAt,
            })
            setTailorOpen(false)
            setNotice(warnings.join(' ') || 'Tailored this resume. Undo if you want the previous page back.')
          }}
        />
      )}
    </div>
  )

  function insertItem(item: ContentItem) {
    const spec = SECTION_FOR[item.type]
    let next = resume
    let section = next.sections.find((row) => row.type === spec.type)
    if (!section) {
      next = addSection(next, spec.type, spec.title)
      section = next.sections[next.sections.length - 1]
    }
    if (!section) return
    const before = next.sections.find((row) => row.id === section?.id)?.entries.length ?? 0
    next = addEntry(next, section.id, item)
    const after = next.sections.find((row) => row.id === section?.id)?.entries.length ?? 0
    if (after === before) {
      setError('That item is already in this section.')
      return
    }
    setError(null)
    commitFrom(resume, next)
  }

  function placeToolbar() {
    const selection = window.getSelection()
    const paper = document.getElementById('resume-paper')
    if (!selection || selection.isCollapsed || !paper || !selection.anchorNode || !paper.contains(selection.anchorNode)) {
      setToolbar(null)
      return
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    const host = paper.parentElement?.getBoundingClientRect()
    if (!host) return
    setToolbar({ top: rect.top - host.top - 36, left: rect.left - host.left })
  }
}

function Editable({
  text,
  onCommit,
  className,
}: {
  text: { html: string; plain: string }
  onCommit: (plain: string, html: string) => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!ref.current || focused.current) return
    ref.current.innerHTML = text.html || ''
  }, [text.html])
  return (
    <div
      ref={ref}
      className={className ? `${className} resume-editable` : 'resume-editable'}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      onFocus={() => { focused.current = true }}
      onBlur={(event) => {
        focused.current = false
        onCommit(event.currentTarget.innerText, event.currentTarget.innerHTML)
      }}
    />
  )
}

function JobTab({
  resume,
  onChange,
  onTailor,
}: {
  resume: Resume
  onChange: (jd: string, pages: number) => void
  onTailor: () => void
}) {
  const [jd, setJd] = useState(resume.jobDescription ?? '')
  const [pages, setPages] = useState(resume.targetPages ?? 1)
  return (
    <div>
      <label className="resume-field">
        Job description
        <textarea rows={8} value={jd} onChange={(e) => { setJd(e.target.value); onChange(e.target.value, pages) }} />
      </label>
      <label className="resume-field">
        Target pages
        <input type="number" min={1} max={4} value={pages} onChange={(e) => { const next = Number(e.target.value) || 1; setPages(next); onChange(jd, next) }} />
      </label>
      {!jd.trim() && <p className="flash error">Paste a posting before tailoring.</p>}
      <button type="button" className="btn primary" onClick={onTailor} disabled={!jd.trim()}>Tailor this resume</button>
      <p className="muted small">Tailoring replaces the page contents and keeps the name. Undo returns the previous version.</p>
    </div>
  )
}

function StatsTab({ resume }: { resume: Resume }) {
  const stats = resume.lastAiBuildStats
  if (!stats) return <p className="muted small">No tailor or auto-build has been saved on this resume yet.</p>
  return (
    <dl className="resume-stats">
      <div><dt>Built</dt><dd>{new Date(stats.builtAtIso).toLocaleString()}</dd></div>
      <div><dt>Pages</dt><dd>{stats.finalPageCount} / target {stats.targetPages} ({stats.finalLastPageFillPercent}% last page)</dd></div>
      <div><dt>Sections</dt><dd>{stats.sectionTitles.join(', ') || 'None'}</dd></div>
      <div><dt>Entries</dt><dd>{stats.entriesTotal}</dd></div>
      <div><dt>Visible bullets</dt><dd>{stats.bulletsVisible}</dd></div>
      <div><dt>Fit score</dt><dd>{stats.avgFinalScoreVisible ?? '—'}</dd></div>
      <div><dt>Evidence in bullets</dt><dd>{stats.avgImpactVisible ?? '—'}%</dd></div>
      <div><dt>Keyword coverage</dt><dd>{stats.keywordCoveragePct}% · {stats.keywordCoverageMissingCount} missing</dd></div>
      <div><dt>Wording alignment</dt><dd>{stats.languageAlignmentApplied ? `${stats.bulletsRewrittenCount} bullets` : stats.languageAlignmentEnabled ? 'On, nothing safe to rewrite' : 'Off'}</dd></div>
      <div><dt>Rejected rewrites</dt><dd>{stats.alignmentRejectedCount}</dd></div>
      <div><dt>Skill spellings normalized</dt><dd>{stats.skillsNormalizedCount}</dd></div>
      <div><dt>Fill</dt><dd>+{stats.fillTraceAddBullets} bullets, −{stats.fillTraceRemoveBullets}, {stats.fillTraceAddEntries} entries placed</dd></div>
    </dl>
  )
}

function StyleSheet({
  theme,
  onChange,
  onClose,
}: {
  theme: ResumeTheme
  onChange: (theme: ResumeTheme) => void
  onClose: () => void
}) {
  function patch(partial: Partial<ResumeTheme>) {
    onChange({ ...theme, ...partial })
  }
  return (
    <aside className="resume-inspector">
      <header className="resume-modal-head">
        <h2>Style</h2>
        <button type="button" className="btn ghost btn-sm" onClick={onClose}>Close</button>
      </header>
      <label className="resume-field">Font<input value={theme.fontFamily ?? ''} onChange={(e) => patch({ fontFamily: e.target.value })} /></label>
      <label className="resume-field">Size (pt)<input type="number" value={theme.fontSizePt ?? 11} onChange={(e) => patch({ fontSizePt: Number(e.target.value) })} /></label>
      <label className="resume-field">Line height<input type="number" step="0.05" value={theme.lineHeight ?? 1.3} onChange={(e) => patch({ lineHeight: Number(e.target.value) })} /></label>
      <label className="resume-field">Text<input type="color" value={theme.textColor ?? '#222222'} onChange={(e) => patch({ textColor: e.target.value })} /></label>
      <label className="resume-field">Accent<input type="color" value={theme.accentColor ?? '#222222'} onChange={(e) => patch({ accentColor: e.target.value })} /></label>
      <label className="resume-field">Section spacing<input type="number" value={theme.sectionSpacingPt ?? 10} onChange={(e) => patch({ sectionSpacingPt: Number(e.target.value) })} /></label>
      <label className="resume-field">Entry spacing<input type="number" value={theme.entrySpacingPt ?? 6} onChange={(e) => patch({ entrySpacingPt: Number(e.target.value) })} /></label>
      <div className="resume-chips">
        {THEME_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="resume-chip" onClick={() => onChange(preset.theme)}>{preset.name}</button>
        ))}
      </div>
    </aside>
  )
}

function ExportDialog({
  resume,
  items,
  onClose,
  onError,
}: {
  resume: Resume
  items: ContentItem[]
  onClose: () => void
  onError: (message: string) => void
}) {
  function download() {
    const bytes = buildDocx(resume, items)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${resume.name || 'resume'}.docx`
    link.click()
    URL.revokeObjectURL(url)
  }

  function printPdf() {
    const paper = document.getElementById('resume-paper')
    if (!paper) {
      onError('The page is not ready to print.')
      return
    }
    const clone = paper.cloneNode(true) as HTMLElement
    clone.querySelectorAll('.jd-mark, .resume-entry-tools, .no-print').forEach((node) => node.remove())
    const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
    if (!popup) {
      onError('Pop-up blocked. Allow pop-ups to print or save a PDF.')
      return
    }
    popup.document.write(`<!DOCTYPE html><html><head><title>${resume.name}</title><style>
      body{margin:0;background:#fff;color:#111}
      .resume-paper{width:8.5in;margin:0 auto;padding:0.6in}
      .jd-mark,.resume-entry-tools,.no-print{display:none!important}
      h3{font-size:12pt;border-bottom:1px solid #222;text-transform:uppercase;letter-spacing:.04em}
      ul{margin:0;padding-left:1.1em}
    </style></head><body>${clone.outerHTML}</body></html>`)
    popup.document.close()
    popup.focus()
    popup.print()
  }

  return (
    <Modal title="Export" onClose={onClose}>
      <p className="muted">Word and print leave off the JD markers. Those are only for reading the draft in FollowUp.</p>
      <div className="resume-actions">
        <button type="button" className="btn primary" onClick={download}>Download Word</button>
        <button type="button" className="btn" onClick={printPdf}>Print or save PDF</button>
      </div>
    </Modal>
  )
}

function ScoreDialog({ resume, items, onClose }: { resume: Resume; items: ContentItem[]; onClose: () => void }) {
  const critique = critiqueResume(resume, items, resume.jobDescription)
  return (
    <Modal title={`Score ${critique.overallScore}`} onClose={onClose}>
      <ul className="resume-score-list">
        {Object.entries(critique.scores).map(([key, row]) => (
          <li key={key}><strong>{key}</strong> {row.score} — {row.summary}</li>
        ))}
      </ul>
      <p>{critique.bulletStats.withMetrics} of {critique.bulletStats.total} bullets include a number.</p>
      {critique.issues.length === 0 ? <p>No issues stood out.</p> : (
        <ul>
          {critique.issues.map((issue) => (
            <li key={`${issue.rank}-${issue.issue}`}><strong>{issue.severity}</strong> {issue.section}: {issue.issue} {issue.fix}</li>
          ))}
        </ul>
      )}
      {critique.keywordAnalysis && (
        <p className="muted small">Missing phrases: {critique.keywordAnalysis.gaps.slice(0, 8).join(', ') || 'none'}</p>
      )}
      <p className="muted small">{critique.topStrengths.join(' ')}</p>
    </Modal>
  )
}
