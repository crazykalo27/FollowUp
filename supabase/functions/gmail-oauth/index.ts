import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'

function appOrigin(): string {
  return Deno.env.get('APP_ORIGIN') || 'http://localhost:5173'
}

function redirectUri(): string {
  const url = Deno.env.get('SUPABASE_URL')!
  // Same function URL; callback is detected via ?code=
  return `${url}/functions/v1/gmail-oauth`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const path = url.pathname

  // Callback from Google — no user JWT; state carries user id
  if (path.endsWith('/callback') || url.searchParams.has('code')) {
    try {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const err = url.searchParams.get('error')
      if (err) {
        return Response.redirect(
          `${appOrigin()}/app/settings?gmail=error&reason=${encodeURIComponent(err)}`,
          302,
        )
      }
      if (!code || !state) {
        return errorResponse('Missing code or state', 400)
      }

      let userId: string
      try {
        const parsed = JSON.parse(atob(state))
        userId = parsed.user_id
      } catch {
        return errorResponse('Invalid state', 400)
      }

      const clientId = Deno.env.get('GOOGLE_GMAIL_CLIENT_ID')
      const clientSecret = Deno.env.get('GOOGLE_GMAIL_CLIENT_SECRET')
      if (!clientId || !clientSecret) {
        return errorResponse('Gmail OAuth not configured', 500)
      }

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri(),
          grant_type: 'authorization_code',
        }),
      })
      const tokens = await tokenRes.json()
      if (!tokenRes.ok) {
        return Response.redirect(
          `${appOrigin()}/app/settings?gmail=error&reason=${encodeURIComponent(tokens.error || 'token_exchange_failed')}`,
          302,
        )
      }

      if (!tokens.refresh_token) {
        return Response.redirect(
          `${appOrigin()}/app/settings?gmail=error&reason=no_refresh_token`,
          302,
        )
      }

      // Fetch account email
      let email: string | null = null
      const profileRes = await fetch(
        'https://www.googleapis.com/oauth2/v2/userinfo',
        { headers: { Authorization: `Bearer ${tokens.access_token}` } },
      )
      if (profileRes.ok) {
        const profile = await profileRes.json()
        email = profile.email || null
      }

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null

      const admin = adminClient()
      await admin.from('gmail_tokens').upsert({
        user_id: userId,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        expires_at: expiresAt,
        email,
        updated_at: new Date().toISOString(),
      })

      return Response.redirect(`${appOrigin()}/app/settings?gmail=connected`, 302)
    } catch (e) {
      return errorResponse(e instanceof Error ? e.message : 'OAuth callback failed', 500)
    }
  }

  // Start OAuth — requires auth
  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth

    const clientId = Deno.env.get('GOOGLE_GMAIL_CLIENT_ID')
    if (!clientId) return errorResponse('GOOGLE_GMAIL_CLIENT_ID not configured', 500)

    const state = btoa(JSON.stringify({ user_id: user.id }))
    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri())
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
    )
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')
    authUrl.searchParams.set('state', state)

    return jsonResponse({ url: authUrl.toString() })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
