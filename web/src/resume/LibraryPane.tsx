import { useMemo, useState } from 'react'
import {
  CONTENT_TYPES,
  contentTypeLabel,
  itemSearchText,
  localCoachReply,
  newId,
  nowIso,
  parseResumeText,
  PRIORITY_OPTIONS,
  suggestBulletRewrites,
  textFromUpload,
  type BulletPoint,
  type ContactField,
  type ContactKind,
  type ContentItem,
  type ContentType,
  type CustomField,
  type ItemPriority,
  type LinkField,
  type SkillGroup,
} from './engine.ts'
import { useVaultApi } from './context.tsx'
import { Confirm, Modal } from './widgets.tsx'

const CONTACT_KINDS: ContactKind[] = ['email', 'phone', 'website', 'linkedin', 'github', 'address', 'custom']

function emptyItem(type: ContentType): ContentItem {
  const ts = nowIso()
  return { id: newId(), type, tags: [], createdAt: ts, updatedAt: ts, priority: 'neutral' }
}

export function LibraryPane() {
  const api = useVaultApi()
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ContentType | 'all'>('all')
  const [tag, setTag] = useState<string | 'all'>('all')
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContentItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return api.vault.items.filter((item) => {
      if (type !== 'all' && item.type !== type) return false
      if (tag !== 'all' && !item.tags.some((name) => name.toLowerCase() === tag.toLowerCase())) return false
      if (q && !itemSearchText(item).includes(q)) return false
      return true
    })
  }, [api.vault.items, query, type, tag])

  function toggle(id: string, shift: boolean) {
    setSelected((prev) => {
      if (shift && anchor) {
        const ids = filtered.map((item) => item.id)
        const start = ids.indexOf(anchor)
        const end = ids.indexOf(id)
        if (start >= 0 && end >= 0) {
          const [lo, hi] = start < end ? [start, end] : [end, start]
          const range = ids.slice(lo, hi + 1)
          return [...new Set([...prev, ...range])]
        }
      }
      return prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]
    })
    setAnchor(id)
  }

  function openNew() {
    setIsNew(true)
    setEditing(emptyItem('experience'))
    setError(null)
  }

  return (
    <div className="resume-pane">
      <div className="resume-pane-bar">
        <label className="resume-search">
          <span className="sr-only">Search library</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, org, bullets, tags" />
        </label>
        <button type="button" className="btn" onClick={openNew}>New item</button>
        <button type="button" className="btn" onClick={() => setUploadOpen(true)}>Upload</button>
        <button type="button" className="btn" onClick={() => setChatOpen(true)}>Coach</button>
      </div>
      <div className="resume-chips" role="tablist" aria-label="Content types">
        <button type="button" className={type === 'all' ? 'resume-chip on' : 'resume-chip'} onClick={() => setType('all')}>All</button>
        {CONTENT_TYPES.map((row) => (
          <button key={row} type="button" className={type === row ? 'resume-chip on' : 'resume-chip'} onClick={() => setType(row)}>
            {contentTypeLabel(row)}
          </button>
        ))}
      </div>
      {api.vault.tags.length > 0 && (
        <div className="resume-chips">
          <button type="button" className={tag === 'all' ? 'resume-chip on' : 'resume-chip'} onClick={() => setTag('all')}>Any tag</button>
          {api.vault.tags.map((row) => (
            <button key={row.id} type="button" className={tag === row.name ? 'resume-chip on' : 'resume-chip'} onClick={() => setTag(row.name)}>
              {row.name}
            </button>
          ))}
        </div>
      )}
      {message && <p className="flash" role="status">{message}</p>}
      {error && <p className="flash error" role="alert">{error}</p>}
      {selected.length > 0 && (
        <div className="resume-bulk">
          <span>{selected.length} selected</span>
          <button type="button" className="btn btn-sm" onClick={() => { api.duplicateItems(selected); setSelected([]); setMessage('Duplicated.') }}>Duplicate</button>
          <button type="button" className="btn btn-sm" onClick={() => setConfirmIds(selected)}>Delete</button>
          <button type="button" className="btn ghost btn-sm" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}
      {api.vault.items.length === 0 ? (
        <div className="resume-empty">
          <h2>Your library is empty</h2>
          <p>Upload a resume or add a role. Tailored pages are assembled from this library, not from a blank document.</p>
          <div className="resume-actions">
            <button type="button" className="btn primary" onClick={() => setUploadOpen(true)}>Upload resume text</button>
            <button type="button" className="btn" onClick={openNew}>Add an item</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="resume-empty">
          <h2>Nothing matches</h2>
          <p>Try another type, tag, or search.</p>
        </div>
      ) : (
        <ul className="resume-cards">
          {filtered.map((item) => (
            <li key={item.id}>
              <article className="resume-card">
                <label className="resume-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(item.id)}
                    onChange={(e) => toggle(item.id, (e.nativeEvent as MouseEvent).shiftKey)}
                    aria-label={`Select ${item.title || contentTypeLabel(item.type)}`}
                  />
                </label>
                <button type="button" className="resume-card-main" onClick={() => { setEditing(item); setIsNew(false) }}>
                  <span className="resume-kicker">{contentTypeLabel(item.type)}</span>
                  <strong>{item.title || 'Untitled'}</strong>
                  <span className="muted small">{[item.organization, item.subtitle].filter(Boolean).join(' · ') || 'No organization yet'}</span>
                  {item.priority && item.priority !== 'neutral' && <span className="resume-pill">{item.priority.replace('_', ' ')}</span>}
                </button>
              </article>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <ItemDrawer
          item={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
          onSave={(item) => {
            api.saveItem(item, isNew)
            setEditing(null)
            setMessage(isNew ? 'Item added.' : 'Item saved.')
          }}
          onDelete={() => {
            api.deleteItems([editing.id])
            setEditing(null)
            setMessage('Item deleted.')
          }}
        />
      )}
      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onImport={(items, note) => {
            api.addItems(items)
            setUploadOpen(false)
            setMessage(note)
            setError(null)
          }}
          onError={setError}
        />
      )}
      {chatOpen && <CoachDialog items={api.vault.items} onAdd={(items) => api.addItems(items)} onClose={() => setChatOpen(false)} />}
      {confirmIds && (
        <Confirm
          title="Delete library items"
          body="Resumes that still point at these items will show a missing-entry warning."
          confirmLabel="Delete"
          onClose={() => setConfirmIds(null)}
          onConfirm={() => {
            api.deleteItems(confirmIds)
            setSelected([])
            setConfirmIds(null)
            setMessage('Deleted.')
          }}
        />
      )}
    </div>
  )
}

function ItemDrawer({
  item,
  isNew,
  onClose,
  onSave,
  onDelete,
}: {
  item: ContentItem
  isNew: boolean
  onClose: () => void
  onSave: (item: ContentItem) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<ContentItem>(item)
  const [tagText, setTagText] = useState(item.tags.join(', '))
  const [jd, setJd] = useState('')
  const [suggestions, setSuggestions] = useState<{ id: string; text: string }[]>([])
  const [refineNote, setRefineNote] = useState<string | null>(null)

  function patch(partial: Partial<ContentItem>) {
    setDraft((prev) => ({ ...prev, ...partial }))
  }

  function save() {
    if (!draft.title?.trim() && draft.type !== 'skills') return
    onSave({
      ...draft,
      tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean),
      skillGroups: (draft.skillGroups ?? []).map((group) => ({
        ...group,
        skills: group.skills.map((skill) => skill.trim()).filter(Boolean),
      })),
    })
  }

  return (
    <div className="resume-drawer" role="dialog" aria-label="Edit library item">
      <header className="resume-modal-head">
        <h2>{isNew ? 'New library item' : 'Edit library item'}</h2>
        <button type="button" className="btn ghost btn-sm" onClick={onClose}>Close</button>
      </header>
      <label className="resume-field">
        Type
        <select value={draft.type} onChange={(e) => patch({ type: e.target.value as ContentType })}>
          {CONTENT_TYPES.map((row) => <option key={row} value={row}>{contentTypeLabel(row)}</option>)}
        </select>
      </label>
      <label className="resume-field">
        Title
        <input value={draft.title ?? ''} onChange={(e) => patch({ title: e.target.value })} />
      </label>
      <label className="resume-field">
        Subtitle
        <input value={draft.subtitle ?? ''} onChange={(e) => patch({ subtitle: e.target.value })} />
      </label>
      <div className="resume-split">
        <label className="resume-field">
          Organization
          <input value={draft.organization ?? ''} onChange={(e) => patch({ organization: e.target.value })} />
        </label>
        <label className="resume-field">
          Location
          <input value={draft.location ?? ''} onChange={(e) => patch({ location: e.target.value })} />
        </label>
      </div>
      <div className="resume-split">
        <label className="resume-field">
          Start
          <input value={draft.startDate ?? ''} placeholder="YYYY-MM" onChange={(e) => patch({ startDate: e.target.value })} />
        </label>
        <label className="resume-field">
          End
          <input value={draft.endDate ?? ''} placeholder="YYYY-MM" disabled={draft.isCurrent} onChange={(e) => patch({ endDate: e.target.value })} />
        </label>
      </div>
      <label className="resume-check-line">
        <input type="checkbox" checked={Boolean(draft.isCurrent)} onChange={(e) => patch({ isCurrent: e.target.checked, endDate: e.target.checked ? undefined : draft.endDate })} />
        Current
      </label>
      <label className="resume-field">
        Description
        <textarea rows={3} value={draft.description ?? ''} onChange={(e) => patch({ description: e.target.value })} />
      </label>
      <BulletEditor bullets={draft.bullets ?? []} onChange={(bullets) => patch({ bullets })} />
      <SkillEditor groups={draft.skillGroups ?? []} onChange={(skillGroups) => patch({ skillGroups })} />
      <ContactEditor fields={draft.contactFields ?? []} onChange={(contactFields) => patch({ contactFields })} />
      <LinkEditor links={draft.links ?? []} onChange={(links) => patch({ links })} />
      <CustomEditor fields={draft.customFields ?? []} onChange={(customFields) => patch({ customFields })} />
      <label className="resume-field">
        Tags
        <input
          value={tagText}
          placeholder="Comma separated"
          onChange={(e) => setTagText(e.target.value)}
        />
      </label>
      <label className="resume-field">
        Priority
        <select value={draft.priority ?? 'neutral'} onChange={(e) => patch({ priority: e.target.value as ItemPriority })}>
          {PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <p className="muted small">{PRIORITY_OPTIONS.find((option) => option.value === (draft.priority ?? 'neutral'))?.hint}</p>
      <label className="resume-field">
        Notes
        <textarea rows={2} value={draft.notes ?? ''} onChange={(e) => patch({ notes: e.target.value })} />
      </label>
      <label className="resume-field">
        Private tailoring notes
        <textarea
          rows={3}
          value={draft.experienceContext ?? ''}
          placeholder="Never printed. Used only when you confirm a posting phrase."
          onChange={(e) => patch({ experienceContext: e.target.value })}
        />
      </label>
      <div className="resume-refine">
        <label className="resume-field">
          Optional posting for suggestions
          <textarea rows={2} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste a job description" />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            const next = suggestBulletRewrites(draft, jd)
            setSuggestions(next)
            setRefineNote(next.length ? 'Suggestions stay inside what you already wrote.' : 'These bullets are already tight.')
          }}
        >
          Get suggestions
        </button>
        {refineNote && <p className="muted small">{refineNote}</p>}
        {suggestions.length > 0 && (
          <ul className="resume-suggest">
            {suggestions.map((row) => <li key={row.id}>{row.text}</li>)}
          </ul>
        )}
        {suggestions.length > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              patch({
                bullets: (draft.bullets ?? []).map((bullet) => {
                  const next = suggestions.find((row) => row.id === bullet.id)
                  return next ? { ...bullet, text: next.text } : bullet
                }),
              })
              setSuggestions([])
              setRefineNote('Applied. Save the item to keep them.')
            }}
          >
            Apply suggestions
          </button>
        )}
      </div>
      {!draft.title?.trim() && draft.type !== 'skills' && <p className="flash error">Add a title before saving.</p>}
      <div className="resume-actions">
        {!isNew && <button type="button" className="btn" onClick={onDelete}>Delete</button>}
        <button type="button" className="btn primary" onClick={save} disabled={!draft.title?.trim() && draft.type !== 'skills'}>Save</button>
      </div>
    </div>
  )
}

function BulletEditor({ bullets, onChange }: { bullets: BulletPoint[]; onChange: (bullets: BulletPoint[]) => void }) {
  return (
    <fieldset className="resume-field">
      <legend>Bullets</legend>
      {bullets.map((bullet, index) => (
        <div key={bullet.id} className="resume-inline">
          <input
            value={bullet.text}
            aria-label={`Bullet ${index + 1}`}
            onChange={(e) => onChange(bullets.map((row) => (row.id === bullet.id ? { ...row, text: e.target.value } : row)))}
          />
          <button type="button" className="btn ghost btn-sm" onClick={() => onChange(bullets.filter((row) => row.id !== bullet.id).map((row, order) => ({ ...row, order })))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...bullets, { id: newId(), text: '', order: bullets.length }])}>Add bullet</button>
    </fieldset>
  )
}

function SkillEditor({ groups, onChange }: { groups: SkillGroup[]; onChange: (groups: SkillGroup[]) => void }) {
  return (
    <fieldset className="resume-field">
      <legend>Skill groups</legend>
      {groups.map((group) => (
        <div key={group.id} className="resume-inline">
          <input
            value={group.category}
            aria-label="Skill category"
            placeholder="Category"
            onChange={(e) => onChange(groups.map((row) => (row.id === group.id ? { ...row, category: e.target.value } : row)))}
          />
          <input
            value={group.skills.join(',')}
            aria-label="Skills"
            placeholder="Comma separated skills"
            onChange={(e) => onChange(groups.map((row) => (row.id === group.id ? { ...row, skills: e.target.value.split(',') } : row)))}
          />
          <button type="button" className="btn ghost btn-sm" onClick={() => onChange(groups.filter((row) => row.id !== group.id))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...groups, { id: newId(), category: '', skills: [], order: groups.length }])}>Add group</button>
    </fieldset>
  )
}

function ContactEditor({ fields, onChange }: { fields: ContactField[]; onChange: (fields: ContactField[]) => void }) {
  return (
    <fieldset className="resume-field">
      <legend>Contact</legend>
      {fields.map((field) => (
        <div key={field.id} className="resume-inline">
          <select
            value={field.type}
            aria-label="Contact type"
            onChange={(e) => onChange(fields.map((row) => (row.id === field.id ? { ...row, type: e.target.value as ContactKind } : row)))}
          >
            {CONTACT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </select>
          <input value={field.value} aria-label="Contact value" onChange={(e) => onChange(fields.map((row) => (row.id === field.id ? { ...row, value: e.target.value } : row)))} />
          <button type="button" className="btn ghost btn-sm" onClick={() => onChange(fields.filter((row) => row.id !== field.id))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...fields, { id: newId(), type: 'email', label: 'Email', value: '', order: fields.length }])}>Add contact</button>
    </fieldset>
  )
}

function LinkEditor({ links, onChange }: { links: LinkField[]; onChange: (links: LinkField[]) => void }) {
  return (
    <fieldset className="resume-field">
      <legend>Links</legend>
      {links.map((link) => (
        <div key={link.id} className="resume-inline">
          <input value={link.label} aria-label="Link label" placeholder="Label" onChange={(e) => onChange(links.map((row) => (row.id === link.id ? { ...row, label: e.target.value } : row)))} />
          <input value={link.url} aria-label="Link URL" placeholder="URL" onChange={(e) => onChange(links.map((row) => (row.id === link.id ? { ...row, url: e.target.value } : row)))} />
          <button type="button" className="btn ghost btn-sm" onClick={() => onChange(links.filter((row) => row.id !== link.id))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...links, { id: newId(), label: '', url: '', order: links.length }])}>Add link</button>
    </fieldset>
  )
}

function CustomEditor({ fields, onChange }: { fields: CustomField[]; onChange: (fields: CustomField[]) => void }) {
  return (
    <fieldset className="resume-field">
      <legend>Custom fields</legend>
      {fields.map((field) => (
        <div key={field.id} className="resume-inline">
          <input value={field.label} aria-label="Field label" placeholder="Label" onChange={(e) => onChange(fields.map((row) => (row.id === field.id ? { ...row, label: e.target.value } : row)))} />
          <input value={field.value} aria-label="Field value" placeholder="Value" onChange={(e) => onChange(fields.map((row) => (row.id === field.id ? { ...row, value: e.target.value } : row)))} />
          <button type="button" className="btn ghost btn-sm" onClick={() => onChange(fields.filter((row) => row.id !== field.id))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...fields, { id: newId(), label: '', value: '', order: fields.length }])}>Add field</button>
    </fieldset>
  )
}

function UploadDialog({
  onClose,
  onImport,
  onError,
}: {
  onClose: () => void
  onImport: (items: ContentItem[], note: string) => void
  onError: (message: string) => void
}) {
  const [text, setText] = useState('')
  const [fileNote, setFileNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    try {
      const raw = await file.text()
      const extracted = textFromUpload(file.name, raw)
      if (!extracted.trim()) {
        setError('That file did not contain readable text. Paste the resume instead.')
        return
      }
      setText(extracted)
      setFileNote(file.name)
      setError(null)
    } catch {
      setError('Could not read that file.')
    }
  }

  function importText() {
    const items = parseResumeText(text)
    if (items.length === 0) {
      const message = 'No resume sections were found. Add headings like Experience, Education, and Skills.'
      setError(message)
      onError(message)
      return
    }
    const note = items.some((item) => item.type !== 'header')
      ? `Imported ${items.length} items. Review them before tailoring.`
      : 'Only a header was found. Add sections or edit the header before tailoring.'
    onImport(items, note)
  }

  return (
    <Modal title="Upload a resume" onClose={onClose}>
      <p className="muted">Text, Markdown, or a best-effort read of PDF and Word. Nothing is sent until you import.</p>
      <label className="resume-upload">
        Choose file
        <input type="file" accept=".txt,.md,.text,.pdf,.doc,.docx" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {fileNote && <p className="muted small">Loaded {fileNote}</p>}
      <label className="resume-field">
        Resume text
        <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a resume" />
      </label>
      {error && <p className="flash error" role="alert">{error}</p>}
      <div className="resume-actions">
        <button type="button" className="btn primary" onClick={importText} disabled={!text.trim()}>Import into library</button>
      </div>
    </Modal>
  )
}

function CoachDialog({
  items,
  onAdd,
  onClose,
}: {
  items: ContentItem[]
  onAdd: (items: ContentItem[]) => void
  onClose: () => void
}) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: 'Paste a resume, or say “add experience: role at company”.' },
  ])
  const [draft, setDraft] = useState('')

  function send() {
    const text = draft.trim()
    if (!text) return
    const result = localCoachReply(text, items)
    if (result.created.length) onAdd(result.created)
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: result.reply }])
    setDraft('')
  }

  return (
    <Modal title="Library coach" onClose={onClose}>
      <div className="resume-chat" role="log">
        {messages.map((message, index) => (
          <p key={index} className={message.role === 'user' ? 'resume-bubble me' : 'resume-bubble'}>{message.content}</p>
        ))}
      </div>
      <div className="resume-inline">
        <input value={draft} aria-label="Message" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send() }} />
        <button type="button" className="btn primary" onClick={send}>Send</button>
      </div>
    </Modal>
  )
}
