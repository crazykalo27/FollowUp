import {
  corsHeaders,
  errorResponse,
  jsonResponse,
  openaiChat,
  requireUser,
  adminClient,
} from '../_shared/cors.ts'
import { recommendFiltersForUser } from '../_shared/recommendFilters.ts'

type Profile = {
  /** Job titles the user wants to land (not their past titles). */
  roles: string[]
  /** Industries / domains they want to work in next. */
  industries: string[]
  /** Company kinds they want (startups, national lab, semiconductor, etc.). */
  company_types: string[]
  /** People to contact at target companies (hiring managers, referrers, senior ICs). */
  outreach_targets: string[]
  /** Resume background — context only; not the primary search target. */
  skills: string[]
  locations: string[]
  /** Seniority level of the job they want. */
  seniority: string
  must_haves: string[]
  tone: string
  notes?: string
  roles_confirmed?: boolean
}

const EMPTY_PROFILE: Profile = {
  roles: [],
  industries: [],
  company_types: [],
  outreach_targets: [],
  skills: [],
  locations: [],
  seniority: '',
  must_haves: [],
  tone: 'professional and concise',
  notes: '',
  roles_confirmed: false,
}

const TOPIC_ORDER = [
  'roles',
  'industries',
  'company_types',
  'outreach_targets',
  'locations',
  'seniority',
  'must_haves',
  'tone',
] as const

function nextMissingTopic(profile: Profile): string | null {
  for (const key of TOPIC_ORDER) {
    const val = profile[key]
    if (Array.isArray(val) && val.length === 0) return key
    if (typeof val === 'string' && !val.trim()) return key
  }
  return null
}

function mergeProfile(base: Profile, patch: Partial<Profile> | null | undefined): Profile {
  if (!patch) return base
  return {
    roles: patch.roles?.length ? patch.roles : base.roles,
    industries: patch.industries?.length ? patch.industries : base.industries,
    company_types: patch.company_types?.length
      ? patch.company_types
      : base.company_types,
    outreach_targets: patch.outreach_targets?.length
      ? patch.outreach_targets
      : base.outreach_targets,
    skills: patch.skills?.length ? patch.skills : base.skills,
    locations: patch.locations?.length ? patch.locations : base.locations,
    seniority: patch.seniority?.trim() ? patch.seniority : base.seniority,
    must_haves: patch.must_haves?.length ? patch.must_haves : base.must_haves,
    tone: patch.tone?.trim() ? patch.tone : base.tone,
    notes: patch.notes ?? base.notes ?? '',
    roles_confirmed:
      typeof patch.roles_confirmed === 'boolean'
        ? patch.roles_confirmed
        : Boolean(base.roles_confirmed),
  }
}

function stripFences(raw: string) {
  const match = raw.match(/```json\s*([\s\S]*?)```/)
  if (match) {
    try {
      return JSON.parse(match[1])
    } catch {
      /* fall through */
    }
  }
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function loadState(admin: ReturnType<typeof adminClient>, userId: string) {
  const [{ data: resume }, { data: history }, { data: sp }] = await Promise.all([
    admin
      .from('resumes')
      .select('extracted_text, file_name')
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from('profile_chat_messages')
      .select('role, content')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(40),
    admin
      .from('search_profiles')
      .select('profile')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  return {
    resume,
    history: history || [],
    profile: mergeProfile(EMPTY_PROFILE, sp?.profile as Partial<Profile> | undefined),
  }
}

async function saveProfile(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  profile: Profile,
  summary: string,
  markComplete: boolean,
) {
  await admin.from('search_profiles').upsert(
    {
      user_id: userId,
      profile,
      chat_summary: summary,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (markComplete) {
    await admin
      .from('profiles')
      .update({ onboarding_complete: true })
      .eq('id', userId)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await requireUser(req)
    if (auth instanceof Response) return auth
    const { user } = auth
    const body = await req.json()
    const action = (body.action as string) || 'reply'
    const finalize = Boolean(body.finalize) || action === 'finalize'
    const message = typeof body.message === 'string' ? body.message.trim() : ''

    const admin = adminClient()
    const state = await loadState(admin, user.id)
    const resumeSnippet = (state.resume?.extracted_text || '').slice(0, 12000)

    // Bootstrap: scan resume, seed profile, ask first question (no user message)
    if (action === 'bootstrap') {
      if (state.history.length > 0) {
        const last = state.history[state.history.length - 1]
        const userMsgs = state.history.filter((m) => m.role === 'user').length
        const awaiting =
          !state.profile.roles_confirmed && userMsgs === 0
        return jsonResponse({
          reply: last.role === 'assistant' ? last.content : null,
          profile: state.profile,
          next_topic: awaiting ? 'roles' : nextMissingTopic(state.profile),
          ready: false,
          awaiting_role_confirm: awaiting,
          already_started: true,
        })
      }

      if (!state.resume) {
        return errorResponse('Upload a resume before starting the profile chat', 400)
      }

      const extractPrompt = `You help a job seeker define what they are LOOKING FOR — not a biography of their resume.

Resume file: ${state.resume.file_name}
Resume text:
${resumeSnippet || '(little/no text extracted)'}

Use the resume only to INFER plausible next-step targets (what jobs/industries fit their trajectory). Do NOT mirror their past job titles as goals unless clearly still what they want.

Return JSON only:
{
  "profile": {
    "roles": [],           // 3–8 JOB TITLES THEY WANT (e.g. "Quantum Software Engineer", not "Student")
    "industries": [],      // 2–8 industries/domains they want to work IN (e.g. "quantum computing", "semiconductors")
    "company_types": [],   // 2–6 kinds of employers (e.g. "quantum hardware startup", "national lab", "GPU company")
    "outreach_targets": [], // 4–10 TYPES OF PEOPLE to email at those companies (e.g. "Engineering Manager", "Director of Quantum", "Principal Scientist", "Staff Engineer who refers")
    "skills": [],          // optional background from resume for context only (max 12) — not the main focus
    "locations": [],
    "seniority": "",       // level they are targeting for their next job
    "must_haves": [],
    "tone": "professional and concise",
    "notes": ""            // 1 sentence: what they're looking for + who to contact
  }
}

Be specific on outreach_targets — these become search filters for people at companies.
Do not invent employers or degrees not in the resume.`

      const extractRaw = await openaiChat(
        [
          {
            role: 'system',
            content:
              'You infer job-search TARGETS from resumes: desired jobs, industries, company types, and who to contact at those companies. Return valid JSON only. Focus on what they want next, not a skills dump.',
          },
          { role: 'user', content: extractPrompt },
        ],
        { temperature: 0.2, response_format: { type: 'json_object' } },
      )

      const extracted = stripFences(extractRaw) || {}
      const profile = mergeProfile(EMPTY_PROFILE, {
        ...(extracted.profile || {}),
        roles_confirmed: false,
      })

      const roleList =
        profile.roles.length > 0
          ? profile.roles.map((r) => `• ${r}`).join('\n')
          : '• (I could not infer clear titles — tell me what you want)'
      const industryBit =
        profile.industries.length > 0
          ? ` Target industries: ${profile.industries.slice(0, 4).join(', ')}.`
          : ''
      const outreachBit =
        profile.outreach_targets.length > 0
          ? `\n\nPeople we should reach out to at those companies:\n${profile.outreach_targets
              .slice(0, 6)
              .map((t) => `• ${t}`)
              .join('\n')}`
          : ''

      const safeReply = ensureSingleQuestion(
        `I read your resume as a clue about what you want next — not as the final answer.

**Jobs you're likely targeting:**
${roleList}
${industryBit}${outreachBit}

Reply to confirm or change the job titles and industries. Then we'll fine-tune company types and who to email (managers, senior engineers, researchers — not HR).`,
      )

      await admin.from('profile_chat_messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: safeReply,
      })
      await saveProfile(admin, user.id, profile, safeReply, false)

      return jsonResponse({
        reply: safeReply,
        profile,
        next_topic: 'roles',
        ready: false,
        awaiting_role_confirm: true,
        already_started: false,
        filters: null,
      })
    }

    // Reply / finalize turns
    if (!finalize && !message) {
      return errorResponse('message is required')
    }

    const userMsgCount = state.history.filter((m) => m.role === 'user').length
    const rolesConfirmed = Boolean(state.profile.roles_confirmed) || userMsgCount > 0

    if (finalize && !rolesConfirmed && userMsgCount === 0) {
      return errorResponse(
        'Confirm or change the target roles with at least one reply before locking the profile.',
        400,
      )
    }

    const userContent = finalize
      ? message ||
        'Please lock the profile with what you have so far. Do not ask another question.'
      : message

    await admin.from('profile_chat_messages').insert({
      user_id: user.id,
      role: 'user',
      content: userContent,
    })

    const awaitingRoleConfirm = !state.profile.roles_confirmed
    const missing = nextMissingTopic(state.profile)

    const turnPrompt = awaitingRoleConfirm
      ? `You are FollowUp's profile builder. Focus on what the user WANTS (jobs, industries, who to contact) — not cataloging their resume skills.

Current profile JSON:
${JSON.stringify(state.profile)}

User reply (confirm / change target jobs & industries):
${userContent}

Resume excerpt (background context only):
${resumeSnippet || '(none)'}

Rules:
- Update profile.roles = job titles they WANT.
- Update profile.industries = where they want to work.
- Infer/refine company_types and outreach_targets from roles+industries if user gives hints.
- Set roles_confirmed=true.
- Do NOT ask them to list skills unless needed to clarify target jobs.
- Reply: acknowledge confirmed jobs/industries, then ONE question about next missing topic (company_types, outreach_targets, locations, seniority).
- finalize=${finalize}: if true, set ready=true, ask no question.
- NEVER more than one question.

Return JSON only:
{"reply":"...","profile":{"roles":[],"industries":[],"company_types":[],"outreach_targets":[],"skills":[],"locations":[],"seniority":"","must_haves":[],"tone":"","notes":"","roles_confirmed":true},"next_topic":"industries|null","ready":false}`
      : `You are FollowUp's profile builder. Clarify what jobs/industries they want and WHO to email at target companies.

Current profile JSON:
${JSON.stringify({ ...state.profile, roles_confirmed: true })}

Suggested next topic: ${missing || 'none — profile looks complete'}
finalize=${finalize}

Resume excerpt (background only):
${resumeSnippet || '(none)'}

Rules:
- roles = jobs they want; industries/company_types = where; outreach_targets = people to contact (titles like Engineering Manager, Director, Principal Scientist, Staff Engineer).
- skills = background context only — do not prioritize expanding skills.
- Merge user answers; keep roles_confirmed=true.
- Conversational reply + exactly ONE question about the next missing topic.
- If finalize=true or profile complete: ready=true, no question, confirm we'll find those companies and people.
- NEVER more than one question.

Return JSON only:
{"reply":"...","profile":{"roles":[],"industries":[],"company_types":[],"outreach_targets":[],"skills":[],"locations":[],"seniority":"","must_haves":[],"tone":"","notes":"","roles_confirmed":true},"next_topic":"company_types|null","ready":false}`

    const historyMsgs = [
      { role: 'system', content: 'Return valid JSON only. One question max per reply.' },
      ...state.history.slice(-20).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: `${userContent}\n\n---\n${turnPrompt}` },
    ]

    const raw = await openaiChat(historyMsgs, {
      temperature: 0.35,
      response_format: { type: 'json_object' },
    })

    const parsed = stripFences(raw) || {}
    let profile = mergeProfile(state.profile, {
      ...(parsed.profile || {}),
      roles_confirmed: true,
    })
    // After first user message, roles are always confirmed
    profile = { ...profile, roles_confirmed: true }

    let ready = Boolean(parsed.ready) || finalize || !nextMissingTopic(profile)
    let reply = (parsed.reply as string) || ''

    if (ready || finalize) {
      ready = true
      reply =
        ensureNoQuestion(
          reply ||
            `Got it — we'll find companies in your target industries and people like: ${profile.outreach_targets.slice(0, 4).join(', ') || 'engineering leaders and senior ICs'} for jobs such as ${profile.roles.slice(0, 4).join(', ') || 'your targets'}.`,
        )
    } else {
      reply = ensureSingleQuestion(
        reply ||
          (awaitingRoleConfirm
            ? `Locked in: ${profile.roles.slice(0, 5).join(', ') || 'your roles'}. ${questionForTopic(nextMissingTopic(profile) || 'industries')}`
            : `Thanks — noted. ${questionForTopic(nextMissingTopic(profile) || 'roles')}`),
      )
    }

    await admin.from('profile_chat_messages').insert({
      user_id: user.id,
      role: 'assistant',
      content: reply,
    })
    await saveProfile(admin, user.id, profile, reply, ready)

    // Sync filters whenever profile is updated from chat
    const filters = await recommendFiltersForUser(admin, user.id)

    return jsonResponse({
      reply,
      profile,
      next_topic: ready ? null : nextMissingTopic(profile),
      ready,
      awaiting_role_confirm: false,
      filters,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})

function questionForTopic(topic: string): string {
  switch (topic) {
    case 'roles':
      return 'What job titles are you actually trying to land?'
    case 'industries':
      return 'Which industries or domains do you want to work in?'
    case 'company_types':
      return 'What kinds of companies should we prioritize (startups, big tech, research labs, hardware vendors, etc.)?'
    case 'outreach_targets':
      return 'Who should we email at those companies — e.g. Engineering Manager, Director, Principal Scientist, Staff Engineer who refers?'
    case 'locations':
      return 'Where do you want to work (cities or remote)?'
    case 'seniority':
      return 'What seniority are you targeting for your next role?'
    case 'must_haves':
      return 'Any must-haves for the job or company?'
    case 'tone':
      return 'What tone should outreach emails use — formal, friendly, or mixed?'
    default:
      return 'Anything else about the jobs or people you want us to find?'
  }
}

function ensureSingleQuestion(text: string): string {
  const cleaned = text.replace(/\n{3,}/g, '\n\n').trim()
  // If model emitted a numbered list of questions, collapse to first question only
  const numbered = cleaned.match(
    /(?:^|\n)\s*(?:1[\).:]|[-*])\s+([^\n]+\?)/,
  )
  if (numbered && /\n\s*2[\).:]/.test(cleaned)) {
    const intro = cleaned.split(/\n\s*1[\).:]/)[0].trim()
    const q = numbered[1].trim()
    return [intro, q].filter(Boolean).join('\n\n')
  }

  const questions = cleaned.match(/[^.!?\n]*\?/g) || []
  if (questions.length <= 1) return cleaned

  // Keep prose before first ?, plus that one question
  const idx = cleaned.indexOf('?')
  return cleaned.slice(0, idx + 1).trim()
}

function ensureNoQuestion(text: string): string {
  return text
    .replace(/\?\s*$/g, '.')
    .replace(/\?/g, '.')
    .trim()
}
