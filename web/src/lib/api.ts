import { supabase, functionsUrl } from './supabase'

export async function invokeFunction<T = unknown>(
  name: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) throw new Error('Not signed in')

  const res = await fetch(functionsUrl(name), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body ?? {}),
  })

  const text = await res.text()
  let json: { error?: string } = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }

  if (res.status === 202) {
    return json as T
  }

  if (!res.ok) {
    if (res.status === 546) {
      throw new Error(
        'Search hit the server time limit. Progress is saved on the Overview — wait for the report or run a low-credits search.',
      )
    }
    throw new Error(
      json.error || text.slice(0, 200) || `Function ${name} failed (${res.status})`,
    )
  }
  return json as T
}
