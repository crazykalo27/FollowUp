import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './auth'
import {
  activateSearchProfile,
  listSearchProfiles,
  resumeFileName,
  type SearchProfileListItem,
} from './searchProfiles'

type Ctx = {
  loading: boolean
  active: SearchProfileListItem | null
  profiles: SearchProfileListItem[]
  refresh: () => Promise<void>
  setActive: (id: string) => Promise<void>
}

const SearchProfileContext = createContext<Ctx | null>(null)

export function SearchProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<SearchProfileListItem[]>([])

  const refresh = useCallback(async () => {
    if (!user) {
      setProfiles([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setProfiles(await listSearchProfiles())
    } catch {
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setActive = useCallback(
    async (id: string) => {
      await activateSearchProfile(id)
      await refresh()
    },
    [refresh],
  )

  const active = useMemo(
    () => profiles.find((p) => p.is_active) || profiles[0] || null,
    [profiles],
  )

  const value = useMemo(
    () => ({ loading, active, profiles, refresh, setActive }),
    [loading, active, profiles, refresh, setActive],
  )

  return (
    <SearchProfileContext.Provider value={value}>
      {children}
    </SearchProfileContext.Provider>
  )
}

export function useSearchProfiles() {
  const ctx = useContext(SearchProfileContext)
  if (!ctx) {
    throw new Error('useSearchProfiles must be used within SearchProfileProvider')
  }
  return ctx
}

export function activeResumeName(active: SearchProfileListItem | null) {
  return active ? resumeFileName(active) : null
}
