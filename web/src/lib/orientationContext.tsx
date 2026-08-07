import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'
import {
  deriveOrientationStep,
  isPageUnlocked,
  pagesForStep,
  pathForStep,
  progressFraction,
  STEP_LABELS,
  type AppPage,
  type OrientationStep,
} from './orientation'

type OrientationContextValue = {
  loading: boolean
  step: OrientationStep
  complete: boolean
  label: string
  fraction: number
  unlocked: Set<AppPage>
  canAccess: (page: AppPage) => boolean
  pathForCurrent: string
  refresh: () => Promise<void>
  advanceTo: (step: OrientationStep) => Promise<void>
  markComplete: () => Promise<void>
}

const OrientationContext = createContext<OrientationContextValue | null>(null)

export function OrientationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState<OrientationStep>('profile')
  const [complete, setComplete] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [{ data: prof, error: profErr }, { count: resumeCount }, { count: keptCount }, { count: draftCount }, { count: contactCount }, { data: doneRun }] =
        await Promise.all([
        supabase
          .from('profiles')
          .select(
            'profile_setup_complete, onboarding_complete, orientation_step, orientation_complete',
          )
          .eq('id', user.id)
          .maybeSingle(),
        supabase
          .from('resumes')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('review_status', 'kept'),
        supabase
          .from('outreach_drafts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('search_runs')
          .select('id, summary')
          .eq('user_id', user.id)
          .eq('status', 'done')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      // Fallback if orientation columns not migrated yet
      let profileRow = prof
      if (profErr) {
        const { data: fallback } = await supabase
          .from('profiles')
          .select('profile_setup_complete, onboarding_complete')
          .eq('id', user.id)
          .maybeSingle()
        profileRow = fallback
          ? {
              ...fallback,
              orientation_step: draftCount && draftCount > 0 ? 'complete' : 'profile',
              orientation_complete: Boolean(draftCount && draftCount > 0),
            }
          : null
      }

      const summary = doneRun?.summary as { contacts_created?: number } | null
      const hasSearchWithContacts =
        Boolean(contactCount && contactCount > 0) ||
        Boolean(summary && (summary.contacts_created || 0) > 0)

      const storedStep = (profileRow?.orientation_step as OrientationStep) || 'profile'
      const filtersContinued =
        storedStep === 'search' ||
        storedStep === 'contacts' ||
        storedStep === 'drafts' ||
        storedStep === 'complete'

      const next = deriveOrientationStep({
        orientation_complete: Boolean(profileRow?.orientation_complete),
        orientation_step: storedStep,
        profile_setup_complete: Boolean(profileRow?.profile_setup_complete),
        onboarding_complete: Boolean(profileRow?.onboarding_complete),
        has_resume: Boolean(resumeCount && resumeCount > 0),
        has_kept_contact: Boolean(keptCount && keptCount > 0),
        has_draft: Boolean(draftCount && draftCount > 0),
        has_search_with_contacts: hasSearchWithContacts,
        filters_continued: filtersContinued,
      })

      setStep(next)
      setComplete(next === 'complete')

      // Persist derived step if ahead of stored (skip when columns missing)
      if (
        !profErr &&
        profileRow &&
        (profileRow.orientation_step !== next ||
          (next === 'complete' && !profileRow.orientation_complete))
      ) {
        await supabase
          .from('profiles')
          .update({
            orientation_step: next,
            orientation_complete: next === 'complete',
            updated_at: new Date().toISOString(),
          })
          .eq('id', user.id)
      }
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const advanceTo = useCallback(
    async (next: OrientationStep) => {
      if (!user) return
      setStep(next)
      setComplete(next === 'complete')
      await supabase
        .from('profiles')
        .update({
          orientation_step: next,
          orientation_complete: next === 'complete',
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
    },
    [user],
  )

  const markComplete = useCallback(async () => {
    await advanceTo('complete')
  }, [advanceTo])

  const value = useMemo<OrientationContextValue>(
    () => ({
      loading,
      step,
      complete,
      label: STEP_LABELS[step],
      fraction: progressFraction(step),
      unlocked: pagesForStep(step),
      canAccess: (page: AppPage) => isPageUnlocked(step, page),
      pathForCurrent: pathForStep(step),
      refresh,
      advanceTo,
      markComplete,
    }),
    [loading, step, complete, refresh, advanceTo, markComplete],
  )

  return (
    <OrientationContext.Provider value={value}>
      {children}
    </OrientationContext.Provider>
  )
}

export function useOrientation() {
  const ctx = useContext(OrientationContext)
  if (!ctx) {
    throw new Error('useOrientation must be used within OrientationProvider')
  }
  return ctx
}
