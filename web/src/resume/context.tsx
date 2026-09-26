import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ContentItem, JobApplication, Resume } from './engine.ts'
import {
  addItems,
  deleteApplication,
  deleteItems,
  deleteResume,
  duplicateItems,
  duplicateResume,
  emptyVault,
  insertResume,
  loadLocal,
  pullVault,
  pushVault,
  replaceItems,
  saveApplication,
  saveItem,
  saveLocal,
  setBilling,
  setProfile,
  updateResume,
  type Vault,
  type VaultBilling,
  type VaultProfile,
} from './vault.ts'

export type RemoteState = 'checking' | 'synced' | 'local'

type VaultApi = {
  vault: Vault
  remote: RemoteState
  email: string
  saveItem: (item: ContentItem, isNew: boolean) => void
  deleteItems: (ids: string[]) => void
  duplicateItems: (ids: string[]) => void
  addItems: (items: ContentItem[]) => void
  replaceItems: (items: ContentItem[]) => void
  createResume: (resume: Resume) => Resume
  updateResume: (resume: Resume) => void
  deleteResume: (id: string) => void
  duplicateResume: (id: string) => Resume
  saveApplication: (application: JobApplication, isNew: boolean) => void
  deleteApplication: (id: string) => void
  setProfile: (profile: VaultProfile) => void
  setBilling: (billing: VaultBilling) => void
}

const VaultContext = createContext<VaultApi | null>(null)

export function ResumeVaultProvider({
  userId,
  email,
  children,
}: {
  userId: string
  email: string
  children: ReactNode
}) {
  const [vault, setVault] = useState<Vault>(() => loadLocal(userId) ?? emptyVault())
  const [remote, setRemote] = useState<RemoteState>('checking')
  const vaultRef = useRef(vault)
  const allowRemote = useRef(true)
  vaultRef.current = vault

  useEffect(() => {
    const local = loadLocal(userId) ?? emptyVault()
    setVault(local)
    vaultRef.current = local
    allowRemote.current = true
    let cancel = false
    void pullVault(userId)
      .then((remoteVault) => {
        if (cancel) return
        if (!remoteVault) {
          setRemote('local')
          return
        }
        const localTime = Date.parse(local.updatedAt) || 0
        const remoteTime = Date.parse(remoteVault.updatedAt) || 0
        if (remoteTime > localTime) {
          setVault(remoteVault)
          vaultRef.current = remoteVault
          saveLocal(userId, remoteVault)
        }
        setRemote('synced')
      })
      .catch(() => {
        if (!cancel) setRemote('local')
      })
    return () => {
      cancel = true
    }
  }, [userId])

  const commit = useCallback((next: Vault) => {
    vaultRef.current = next
    setVault(next)
    saveLocal(userId, next)
    if (!allowRemote.current) {
      setRemote('local')
      return
    }
    void pushVault(userId, next).then((ok) => {
      if (ok) setRemote('synced')
      else {
        allowRemote.current = false
        setRemote('local')
      }
    })
  }, [userId])

  const api = useMemo<VaultApi>(() => ({
    vault,
    remote,
    email,
    saveItem: (item, isNew) => commit(saveItem(vaultRef.current, item, isNew)),
    deleteItems: (ids) => commit(deleteItems(vaultRef.current, ids)),
    duplicateItems: (ids) => commit(duplicateItems(vaultRef.current, ids)),
    addItems: (items) => commit(addItems(vaultRef.current, items)),
    replaceItems: (items) => commit(replaceItems(vaultRef.current, items)),
    createResume: (resume) => {
      const result = insertResume(vaultRef.current, resume)
      commit(result.vault)
      return result.resume
    },
    updateResume: (resume) => commit(updateResume(vaultRef.current, resume)),
    deleteResume: (id) => commit(deleteResume(vaultRef.current, id)),
    duplicateResume: (id) => {
      const result = duplicateResume(vaultRef.current, id)
      commit(result.vault)
      return result.resume
    },
    saveApplication: (application, isNew) => commit(saveApplication(vaultRef.current, application, isNew)),
    deleteApplication: (id) => commit(deleteApplication(vaultRef.current, id)),
    setProfile: (profile) => commit(setProfile(vaultRef.current, profile)),
    setBilling: (billing) => commit(setBilling(vaultRef.current, billing)),
  }), [vault, remote, email, commit])

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>
}

export function useVaultApi(): VaultApi {
  const api = useContext(VaultContext)
  if (!api) throw new Error('Resume vault is missing')
  return api
}
