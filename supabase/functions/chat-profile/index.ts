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
  roles: string[]
  industries: string[]
  company_types: string[]
  outreach_targets: string[]
  skills: string[]
  locations: string[]
  seniority: string
  employment_types: string[]
  remote_preference: string
  company_size: string
  must_haves: string[]
  tone: string
  notes?: string
  roles_confirmed?: boolean
  /** 0 = locations … 6 = roles; 7 = series complete awaiting save */
  orientation_q?: number
}

const EMPTY_PROFILE: Profile = {
  roles: [],
  industries: [],
  company_types: [],
  outreach_targets: [],
  skills: [],
  locations: [],
  seniority: '',
  employment_types: [],
  remote_preference: '',
  company_size: '',
  must_haves: [],
  tone: 'professional and concise',
  notes: '',
  roles_confirmed: false,
  orientation_q: 0,
}

const SERIES_DONE = 7

/** Closed-ended steps that show tap-to-send buttons in the Profile UI */
const QUICK_ANSWER_KEYS = new Set([
  'locations',
  'employment_types',
  'remote_preference',
  'company_size',
  'seniority',
])

const QUICK_ANSWER_HINT = 'Type or press the buttons below to respond.'

function withQuickAnswerHint(key: string, question: string): string {
  if (!QUICK_ANSWER_KEYS.has(key)) return question
  return `${question}\n\n${QUICK_ANSWER_HINT}`
}

const QUESTIONS: {
  key: string
  ask: (p: Profile) => string
}[] = [
  {
    key: 'locations',
    ask: () =>
      'Do you have location priorities for your next job? If so, what are they (cities, regions, or “no preference”)?',
  },
  {
    key: 'employment_types',
    ask: () =>
      'What type of job are you hoping to find: full-time, part-time, or internship?',
  },
  {
    key: 'remote_preference',
    ask: () =>
      'Are you looking for remote, in-person, or hybrid?',
  },
  {
    key: 'company_size',
    ask: () =>
      'Are you looking for large, medium, or small company size?',
  },
  {
    key: 'seniority',
    ask: () =>
      'Are you looking for entry, mid-level, or experienced positions?',
  },
  {
    key: 'industries',
    ask: (p) => {
      const list =
        p.industries.length > 0
          ? p.industries.map((i) => `• ${i}`).join('\n')
          : '• (none confidently extracted — tell me specific niches)'
      return `From your resume I inferred these SPECIFIC industry niches (not generic labels):\n${list}\n\nWhich niches are you actually targeting? Confirm, edit, or replace with equally specific industries (e.g. “radar signal processing”, not “engineering”).`
    },
  },
  {
    key: 'roles',
    ask: (p) => {
      const list =
        p.roles.length > 0
          ? p.roles.map((r) => `• ${r}`).join('\n')
          : '• (suggest a few titles you’d want)'
      return `Based on those industries and your resume, here are job titles I suggest we search for:\n${list}\n\nWhich titles should we use? Confirm, edit, or replace them.`
    },
  },
]

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
    employment_types: patch.employment_types?.length
      ? patch.employment_types
      : base.employment_types,
    remote_preference: patch.remote_preference?.trim()
      ? patch.remote_preference
      : base.remote_preference,
    company_size: patch.company_size?.trim()
      ? patch.company_size
      : base.company_size,
    must_haves: patch.must_haves?.length ? patch.must_haves : base.must_haves,
    tone: patch.tone?.trim() ? patch.tone : base.tone,
    notes: patch.notes ?? base.notes ?? '',
    roles_confirmed:
      typeof patch.roles_confirmed === 'boolean'
        ? patch.roles_confirmed
        : Boolean(base.roles_confirmed),
    orientation_q:
      typeof patch.orientation_q === 'number'
        ? patch.orientation_q
        : base.orientation_q ?? 0,
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

function ensureSingleQuestion(text: string): string {
  const cleaned = text.replace(/\n{3,}/g, '\n\n').trim()
  const numbered = cleaned.match(/(?:^|\n)\s*(?:1[\).:]|[-*])\s+([^\n]+\?)/)
  if (numbered && /\n\s*2[\).:]/.test(cleaned)) {
    const intro = cleaned.split(/\n\s*1[\).:]/)[0].trim()
    const q = numbered[1].trim()
    return [intro, q].filter(Boolean).join('\n\n')
  }
  const questions = cleaned.match(/[^.!?\n]*\?/g) || []
  if (questions.length <= 1) return cleaned
  const idx = cleaned.indexOf('?')
  return cleaned.slice(0, idx + 1).trim()
}

function ensureNoQuestion(text: string): string {
  return text
    .replace(/\?\s*$/g, '.')
    .replace(/\?/g, '.')
    .trim()
}

function applyCompanySizeToTypes(profile: Profile): Profile {
  const size = (profile.company_size || '').toLowerCase()
  if (!size) return profile
  const label =
    size.includes('large') || size.includes('big')
      ? 'large company'
      : size.includes('small') || size.includes('startup')
        ? 'small company'
        : size.includes('medium') || size.includes('mid')
          ? 'medium company'
          : ''
  if (!label) return profile
  const rest = (profile.company_types || []).filter(
    (t) => !/^(large|medium|small)\s+company$/i.test(t),
  )
  return { ...profile, company_types: [label, ...rest] }
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
      .update({
        onboarding_complete: true,
        orientation_step: 'filters',
        updated_at: new Date().toISOString(),
      })
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

    if (action === 'bootstrap') {
      if (state.history.length > 0) {
        const last = state.history[state.history.length - 1]
        const q = state.profile.orientation_q ?? 0
        return jsonResponse({
          reply: last.role === 'assistant' ? last.content : null,
          profile: state.profile,
          next_topic: q < SERIES_DONE ? QUESTIONS[q]?.key ?? null : null,
          ready: q >= SERIES_DONE && Boolean(state.profile.roles_confirmed),
          series_complete: q >= SERIES_DONE,
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

Use the resume only to INFER plausible next-step targets. Do NOT treat past titles as confirmed goals.

Return JSON only:
{
  "profile": {
    "roles": [],
    "industries": [],
    "company_types": [],
    "outreach_targets": [],
    "skills": [],
    "locations": [],
    "employment_types": [],
    "remote_preference": "",
    "company_size": "",
    "seniority": "",
    "must_haves": [],
    "tone": "professional and concise",
    "notes": ""
  }
}

CRITICAL — industries must be SPECIFIC niches (4–8 items), not generic buckets.
Good: "FPGA semiconductor design", "edge AI inference hardware", "quantum control electronics".
Bad: "technology", "software", "engineering", "IT", "business".
Each industry should be a concrete sector a recruiter could search.

Seed roles (4–8 desired titles that fit those niches) and industries (4–8 specific niches) for later confirmation.
Leave locations/employment/remote/company_size/seniority empty — we ask those first.
Be specific on outreach_targets (who to email at those companies). Do not invent employers or degrees not in the resume.`

      const extractRaw = await openaiChat(
        [
          {
            role: 'system',
            content:
              'You infer SPECIFIC job-search TARGET niches from resumes. Never return generic industries. Return valid JSON only.',
          },
          { role: 'user', content: extractPrompt },
        ],
        { temperature: 0.25, response_format: { type: 'json_object' } },
      )

      const extracted = stripFences(extractRaw) || {}
      let profile = mergeProfile(EMPTY_PROFILE, {
        ...(extracted.profile || {}),
        roles_confirmed: false,
        orientation_q: 0,
      })

      const q0 = withQuickAnswerHint(QUESTIONS[0].key, QUESTIONS[0].ask(profile))
      const safeReply = ensureSingleQuestion(
        `I scanned your resume for specific niches we can search — not generic labels. I'll ask a short series of questions, then we'll calibrate with a small search.\n\n${q0}`,
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
        next_topic: QUESTIONS[0].key,
        ready: false,
        series_complete: false,
        already_started: false,
        filters: null,
      })
    }

    if (!finalize && !message) {
      return errorResponse('message is required')
    }

    const qIndex = Math.min(
      SERIES_DONE,
      typeof state.profile.orientation_q === 'number'
        ? state.profile.orientation_q
        : 0,
    )

    if (finalize) {
      if (qIndex < SERIES_DONE && !state.profile.roles_confirmed) {
        return errorResponse(
          'Finish the orientation questions before saving your profile.',
          400,
        )
      }

      const userContent =
        message ||
        'Please lock the profile with what you have so far. Do not ask another question.'

      await admin.from('profile_chat_messages').insert({
        user_id: user.id,
        role: 'user',
        content: userContent,
      })

      let profile = applyCompanySizeToTypes({
        ...state.profile,
        roles_confirmed: true,
        orientation_q: SERIES_DONE,
      })
      if (!profile.outreach_targets?.length) {
        profile = {
          ...profile,
          outreach_targets: [
            'Engineering Manager',
            'Hiring Manager',
            'Director',
            'Team Lead',
          ],
        }
      }

      const reply = ensureNoQuestion(
        `Profile saved. Next we'll review company and contact targets on Filters — then you can run a search for direct contacts.`,
      )

      await admin.from('profile_chat_messages').insert({
        user_id: user.id,
        role: 'assistant',
        content: reply,
      })
      await saveProfile(admin, user.id, profile, reply, true)
      const filters = await recommendFiltersForUser(admin, user.id)

      return jsonResponse({
        reply,
        profile,
        next_topic: null,
        ready: true,
        series_complete: true,
        filters,
      })
    }

    // Normal reply: update current question field, advance to next
    await admin.from('profile_chat_messages').insert({
      user_id: user.id,
      role: 'user',
      content: message,
    })

    const currentKey = qIndex < SERIES_DONE ? QUESTIONS[qIndex].key : 'done'

    const turnPrompt = `You are FollowUp's orientation interviewer. The user is answering question ${qIndex + 1} of 7 about: ${currentKey}.

Current profile JSON:
${JSON.stringify(state.profile)}

User reply:
${message}

Resume excerpt (background only):
${resumeSnippet || '(none)'}

Rules:
- Update ONLY the fields relevant to "${currentKey}" from the user's reply (you may lightly refine related fields).
- For locations: set locations[] (use ["no preference"] if they have none).
- For employment_types: full-time / part-time / internship (array).
- For remote_preference: remote | in-person | hybrid | flexible.
- For company_size: large | medium | small (or mix).
- For seniority: entry | mid | experienced (normalize their words).
- For industries: set industries[] from their clarification.
- For roles: set roles[] from their clarification and set roles_confirmed=true.
- Set orientation_q to ${Math.min(SERIES_DONE, qIndex + 1)}.
- reply: ONE short acknowledgment sentence only. Do NOT ask any question. Do NOT mention the next topic. No question marks.
- NEVER ask a question in reply.

Return JSON only:
{"reply":"...","profile":{"roles":[],"industries":[],"company_types":[],"outreach_targets":[],"skills":[],"locations":[],"employment_types":[],"remote_preference":"","company_size":"","seniority":"","must_haves":[],"tone":"","notes":"","roles_confirmed":false,"orientation_q":0}}`

    const historyMsgs = [
      {
        role: 'system',
        content:
          'Return valid JSON only. Your reply field must be a short acknowledgment with ZERO questions.',
      },
      ...state.history.slice(-20).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: `${message}\n\n---\n${turnPrompt}` },
    ]

    const raw = await openaiChat(historyMsgs, {
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })

    const parsed = stripFences(raw) || {}
    // Always advance exactly one step — never trust the model to jump or ask ahead
    const nextQ = Math.min(SERIES_DONE, qIndex + 1)
    let profile = mergeProfile(state.profile, {
      ...(parsed.profile || {}),
      orientation_q: nextQ,
    })
    profile = {
      ...profile,
      orientation_q: nextQ,
      roles_confirmed: nextQ >= SERIES_DONE ? true : Boolean(profile.roles_confirmed),
    }
    profile = applyCompanySizeToTypes(profile)

    // After industries confirmed (step 5 answered → nextQ 6), refresh role suggestions if empty
    if (nextQ === 6 && profile.roles.length === 0) {
      const suggestRaw = await openaiChat(
        [
          {
            role: 'system',
            content: 'Suggest job titles as JSON {"roles":[]} only.',
          },
          {
            role: 'user',
            content: `Industries: ${profile.industries.join(', ')}\nResume:\n${resumeSnippet.slice(0, 6000)}\nReturn 4–8 desired job titles.`,
          },
        ],
        { temperature: 0.3, response_format: { type: 'json_object' } },
      )
      const suggested = stripFences(suggestRaw)
      if (suggested?.roles?.length) {
        profile = { ...profile, roles: suggested.roles }
      }
    }

    let reply = (parsed.reply as string) || ''
    const seriesComplete = nextQ >= SERIES_DONE

    if (seriesComplete) {
      reply = ensureNoQuestion(
        reply ||
          `Your profile looks complete. Clarify anything else in chat, or press Save profile to continue to Filters.`,
      )
      if (!/save profile/i.test(reply)) {
        reply += ' Press Save profile when you are ready.'
      }
      reply = ensureNoQuestion(reply)
    } else {
      // Scripted next question only — strip any model questions from the ack
      const ackClean = ensureNoQuestion(
        (reply || 'Got it.').replace(/\?/g, '.').trim() || 'Got it.',
      )
      const nextAsk = withQuickAnswerHint(
        QUESTIONS[nextQ].key,
        QUESTIONS[nextQ].ask(profile),
      )
      reply = `${ackClean}\n\n${nextAsk}`
    }

    await admin.from('profile_chat_messages').insert({
      user_id: user.id,
      role: 'assistant',
      content: reply,
    })
    await saveProfile(admin, user.id, profile, reply, false)

    const filters = seriesComplete
      ? await recommendFiltersForUser(admin, user.id)
      : null

    return jsonResponse({
      reply,
      profile,
      next_topic: seriesComplete ? null : QUESTIONS[nextQ]?.key ?? null,
      ready: false,
      series_complete: seriesComplete,
      filters,
    })
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Unexpected error', 500)
  }
})
