import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { invokeFunction } from '../lib/api'
import {
  attachResumeToProfile,
  createSearchProfile,
  deleteSearchProfile,
  profileNicheLine,
  renameSearchProfile,
  resumeFileName,
} from '../lib/searchProfiles'
import { useSearchProfiles } from '../lib/searchProfileContext'
import './admin.css'

export function SearchProfilesModal({
  onClose,
  onSwitched,
}: {
  onClose: () => void
  onSwitched?: () => void
}) {
  const { user } = useAuth()
  const { profiles, refresh, setActive, active } = useSearchProfiles()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceForId = useRef<string | null>(null)

  async function uploadResumeFile(file: File) {
    if (!user) return null
    const path = `${user.id}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabase.storage
      .from('resumes')
      .upload(path, file, { upsert: true })
    if (upErr) throw upErr
    const { data: row, error } = await supabase
      .from('resumes')
      .insert({
        user_id: user.id,
        storage_path: path,
        file_name: file.name,
      })
      .select('id')
      .single()
    if (error) throw error
    await invokeFunction('parse-resume', { resume_id: row.id })
    return row.id as string
  }

  async function onAdd(file: File) {
    setBusy(true)
    setStatus(null)
    try {
      const resumeId = await uploadResumeFile(file)
      if (!resumeId) return
      const created = await createSearchProfile(resumeId, file.name.replace(/\.[^.]+$/, ''))
      await setActive(created.profile.id)
      onSwitched?.()
      setStatus('New search profile is active. Chat will use this resume.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not add profile')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onReplace(id: string, file: File) {
    setBusy(true)
    setStatus(null)
    try {
      const resumeId = await uploadResumeFile(file)
      if (!resumeId) return
      await attachResumeToProfile(id, resumeId)
      await refresh()
      setStatus('Resume replaced on this search profile.')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not replace resume')
    } finally {
      setBusy(false)
      replaceForId.current = null
    }
  }

  async function onSwitch(id: string) {
    setBusy(true)
    setStatus(null)
    try {
      await setActive(id)
      onSwitched?.()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not switch')
    } finally {
      setBusy(false)
    }
  }

  async function onRename(id: string) {
    setBusy(true)
    try {
      await renameSearchProfile(id, editName)
      setEditingId(null)
      await refresh()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not rename')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (profiles.length <= 1) {
      setStatus('Keep at least one search profile.')
      return
    }
    if (!confirm('Delete this search profile and its resume? Contacts stay, tagged with the old name.')) {
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      await deleteSearchProfile(id)
      await refresh()
      onSwitched?.()
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not delete')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal search-profiles-modal"
        role="dialog"
        aria-labelledby="sp-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sp-title">Search profiles and resumes</h2>
        <p className="muted small">
          Each profile is a niche: its own resume, chat, and search terms.
          Switch which one is active before you search.
        </p>
        {status && <p className="flash">{status}</p>}
        <ul className="sp-list">
          {profiles.map((p) => {
            const file = resumeFileName(p)
            const niche = profileNicheLine(p.profile)
            return (
              <li key={p.id} className={p.is_active ? 'on' : undefined}>
                <div className="sp-list-main">
                  {editingId === p.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        void onRename(p.id)
                      }}
                    >
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                        disabled={busy}
                      />
                      <button type="submit" className="btn btn-sm primary" disabled={busy}>
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      <strong>{p.name}</strong>
                      {p.is_active && <span className="pill">Active</span>}
                    </>
                  )}
                  <p className="muted small">
                    {file || 'No resume'} · {niche}
                  </p>
                </div>
                <div className="sp-list-actions">
                  {!p.is_active && (
                    <button
                      type="button"
                      className="btn btn-sm primary"
                      disabled={busy}
                      onClick={() => void onSwitch(p.id)}
                    >
                      Use this
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(p.id)
                      setEditName(p.name)
                    }}
                  >
                    Rename
                  </button>
                  <label className="btn btn-sm">
                    <input
                      type="file"
                      hidden
                      accept=".pdf,.doc,.docx,.txt,application/pdf,text/plain"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void onReplace(p.id, f)
                      }}
                    />
                    Replace resume
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm swipe-discard"
                    disabled={busy || profiles.length <= 1}
                    onClick={() => void onDelete(p.id)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="actions">
          <label className="btn primary">
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".pdf,.doc,.docx,.txt,application/pdf,text/plain"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onAdd(f)
              }}
            />
            {busy ? 'Working…' : 'Add resume / profile'}
          </label>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {active && (
          <p className="muted small">
            Active: <strong>{active.name}</strong>
            {resumeFileName(active) ? ` · ${resumeFileName(active)}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}
