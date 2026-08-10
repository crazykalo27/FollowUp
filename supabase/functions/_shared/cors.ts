import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status)
}

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, key)
}

export function userClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  })
}

export async function requireUser(
  req: Request,
): Promise<{ user: User; authHeader: string } | Response> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return errorResponse('Missing Authorization', 401)

  const supabase = userClient(authHeader)
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return errorResponse('Unauthorized', 401)
  return { user: data.user, authHeader }
}

export async function hunterGet(path: string, params: Record<string, string>) {
  const key = Deno.env.get('HUNTER_API_KEY')
  if (!key) throw new Error('HUNTER_API_KEY is not configured')

  const url = new URL(`https://api.hunter.io/v2/${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString(), {
    headers: { 'X-API-Key': key },
  })
  const body = await res.json()
  if (!res.ok) {
    const msg =
      body?.errors?.[0]?.details ||
      body?.errors?.[0]?.id ||
      `Hunter API error ${res.status}`
    throw new Error(msg)
  }
  return body
}

export type OpenAiChatMessage = {
  role: string
  content?: string | null
  tool_calls?: Array<{
    id: string
    type?: string
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export type OpenAiToolDef = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}

export async function openaiChat(
  messages: { role: string; content: string }[],
  opts?: { temperature?: number; response_format?: { type: string } },
) {
  const message = await openaiChatRaw(messages, opts)
  return (message.content || '') as string
}

/** Full chat completion message (supports tool calling). */
export async function openaiChatRaw(
  messages: OpenAiChatMessage[],
  opts?: {
    temperature?: number
    response_format?: { type: string }
    tools?: OpenAiToolDef[]
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
    model?: string
  },
): Promise<OpenAiChatMessage> {
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) throw new Error('OPENAI_API_KEY is not configured')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts?.model || 'gpt-4o-mini',
      temperature: opts?.temperature ?? 0.4,
      messages,
      ...(opts?.response_format
        ? { response_format: opts.response_format }
        : {}),
      ...(opts?.tools ? { tools: opts.tools, tool_choice: opts.tool_choice || 'auto' } : {}),
    }),
  })

  const body = await res.json()
  if (!res.ok) {
    throw new Error(body?.error?.message || `OpenAI error ${res.status}`)
  }
  return (body.choices?.[0]?.message || { role: 'assistant', content: '' }) as OpenAiChatMessage
}

export function titleMatchesFilters(
  title: string | null | undefined,
  include: string[],
  exclude: string[],
): { ok: boolean; reason: string } {
  const t = (title || '').toLowerCase()
  if (!t) return { ok: false, reason: 'missing title' }

  for (const ex of exclude) {
    if (ex && t.includes(ex.toLowerCase())) {
      return { ok: false, reason: `excluded by "${ex}"` }
    }
  }

  for (const inc of include) {
    if (!inc) continue
    const needle = inc.toLowerCase().trim()
    if (!needle || needle.length > 70) continue
    if (t.includes(needle)) {
      return { ok: true, reason: `matched include "${inc}"` }
    }
    // Token overlap for nearby titles (e.g. "RTL Engineer" ≈ "RTL Design Engineer")
    const incToks = needle
      .split(/[\s/|,]+/)
      .filter((w) => w.length > 2 && !/^(and|the|for|with)$/.test(w))
    if (incToks.length >= 2) {
      const hits = incToks.filter((tok) => t.includes(tok)).length
      if (hits >= Math.ceil(incToks.length * 0.7) && hits >= 2) {
        return { ok: true, reason: `matched include tokens "${inc}"` }
      }
    }
  }

  return { ok: false, reason: 'no include title match' }
}

/** Rank outreach targets — managers, senior ICs, researchers, recruiters. */
export function scoreOutreachTitle(title: string | null | undefined): number {
  const t = (title || '').toLowerCase()
  if (!t) return 0
  const rules: Array<{ re: RegExp; score: number }> = [
    { re: /\bdirector\b/, score: 10 },
    { re: /\bengineering manager\b/, score: 9 },
    { re: /\bprincipal engineer\b/, score: 8 },
    { re: /\bstaff engineer\b/, score: 8 },
    { re: /\bstaff (rtl|digital|hardware|asic|fpga)\b/, score: 8 },
    { re: /\bresearch scientist\b/, score: 8 },
    { re: /\bprincipal scientist\b/, score: 8 },
    { re: /\bsenior research scientist\b/, score: 7 },
    { re: /\blead (rtl|digital|hardware|asic|fpga|design)\b/, score: 7 },
    { re: /\blead engineer\b/, score: 7 },
    { re: /\bsenior scientist\b/, score: 7 },
    { re: /\bquantum (engineer|scientist|researcher)\b/, score: 7 },
    { re: /\brtl design engineer\b/, score: 7 },
    { re: /\bdigital design engineer\b/, score: 7 },
    { re: /\bhardware design engineer\b/, score: 7 },
    { re: /\basic design engineer\b/, score: 7 },
    { re: /\bfpga (design )?engineer\b/, score: 7 },
    { re: /\bsenior (rtl|digital|hardware|design) engineer\b/, score: 7 },
    { re: /\bsenior engineer\b/, score: 6 },
    { re: /\bresearch engineer\b/, score: 6 },
    { re: /\bcompiler engineer\b/, score: 6 },
    { re: /\bhardware engineer\b/, score: 6 },
    { re: /\bdesign engineer\b/, score: 6 },
    { re: /\brtl engineer\b/, score: 6 },
    { re: /\bmember of technical staff\b/, score: 6 },
    { re: /\btechnical staff\b/, score: 5 },
    { re: /\brecruiter\b/, score: 5 },
    { re: /\btalent acquisition\b/, score: 5 },
    { re: /\bsoftware engineer\b/, score: 4 },
    { re: /\bscientist\b/, score: 4 },
    { re: /\bengineer\b/, score: 3 },
  ]
  let best = 0
  for (const { re, score } of rules) {
    if (re.test(t)) best = Math.max(best, score)
  }
  return best
}

export function extractDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null
  try {
    let s = urlOrHost.trim()
    if (!s.includes('://')) s = `https://${s}`
    const host = new URL(s).hostname.replace(/^www\./, '')
    if (!host || host.includes('remotive') || host.includes('linkedin')) return null
    return host
  } catch {
    return null
  }
}
