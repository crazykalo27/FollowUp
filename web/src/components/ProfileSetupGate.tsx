import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/** Redirect new users until full name (and optional LinkedIn) are saved. */
export function ProfileSetupGate() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const [checking, setChecking] = useState(true)
  const [complete, setComplete] = useState(true)

  useEffect(() => {
    if (!user) {
      setChecking(false)
      return
    }
    void (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('profile_setup_complete, full_name, display_name')
        .eq('id', user.id)
        .maybeSingle()

      if (error) {
        console.warn('profiles load failed', error.message)
        const { data: fallback } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle()
        setComplete(Boolean(fallback?.display_name?.trim()))
        setChecking(false)
        return
      }

      const name = (data?.full_name || data?.display_name || '').trim()
      const ok =
        Boolean(data?.profile_setup_complete) && name.length >= 2
      setComplete(ok)
      setChecking(false)
    })()
  }, [user])

  if (authLoading || checking) {
    return <div className="page-center muted">Loading…</div>
  }

  const onSetupPath = location.pathname === '/app/welcome'

  if (!complete && !onSetupPath) {
    return <Navigate to="/app/welcome" replace />
  }

  return <Outlet />
}
