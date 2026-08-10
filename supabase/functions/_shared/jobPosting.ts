import { openaiChatRaw } from './cors.ts'

export type ParsedJobPosting = {
  company: string
  job_title: string
  /** First-person role summary for emails / light search hints */
  job_description: string
  /** Job location if stated in the posting (city/region/remote) */
  location: string
  /** Teams, products, or named projects from the posting */
  projects: string[]
  /** Specific responsibilities / focus areas */
  responsibilities: string[]
  /** Titles to search for (exact role + senior / nearby technical) */
  search_titles: string[]
  /** Keywords for LinkedIn dept / project queries (keep light) */
  search_keywords: string[]
}

function uniqTrim(items: string[], limit = 12): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

function seniorVariants(title: string): string[] {
  const t = title.trim()
  if (!t) return []
  const lower = t.toLowerCase()
  const out: string[] = [t]
  if (!/\bsenior\b|\bstaff\b|\bprincipal\b|\blead\b|\bmanager\b|\bdirector\b/i.test(t)) {
    out.push(`Senior ${t}`, `Staff ${t}`, `Lead ${t}`)
  }
  if (!/\bmanager\b|\bdirector\b|\bhead\b/i.test(t)) {
    const base = t.replace(/^(senior|staff|principal|lead)\s+/i, '').trim()
    if (base) {
      out.push(`${base} Manager`, `Engineering Manager`)
    }
  }
  if (lower.includes('software engineer')) {
    out.push('Software Engineer', 'Senior Software Engineer', 'Staff Software Engineer')
  }
  return uniqTrim(out, 10)
}

function firstPersonRoleSummary(parts: {
  job_title?: string
  company?: string
  projects?: string[]
  responsibilities?: string[]
  location?: string
}): string {
  const title = parts.job_title?.trim()
  const company = parts.company?.trim()
  const project = parts.projects?.[0]?.trim()
  const focus = parts.responsibilities?.[0]?.trim()
  const location = parts.location?.trim()

  if (!title && !company && !project) return ''

  let s = 'I applied for'
  if (title) s += ` the ${title} role`
  else s += ' this role'
  if (company) s += ` at ${company}`
  if (project) s += ` on the ${project} team/project`
  if (location) s += ` (${location})`
  s += '.'
  if (focus) {
    const clipped = focus.replace(/\.$/, '').slice(0, 120)
    s += ` I'm especially interested in ${clipped}.`
  }
  return s.slice(0, 500)
}

/** Light tokens from a first-person summary — for soft people-search boosts only. */
export function lightSearchHintsFromSummary(summary: string): string[] {
  const raw = summary.replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const stop = new Set([
    'i', 'applied', 'for', 'the', 'role', 'at', 'on', 'team', 'project',
    'and', 'a', 'an', 'to', 'of', 'in', 'my', 'im', "i'm", 'especially',
    'interested', 'this', 'with', 'that', 'as',
  ])
  const words = raw
    .replace(/[^\w\s\-/.]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3 && !stop.has(w.toLowerCase()))
  return uniqTrim(words, 4)
}

function heuristicLocation(text: string): string {
  const patterns = [
    /(?:^|\n)\s*(?:location|based in|office|hq)\s*[:\-–]\s*(.+)/i,
    /\b(?:remote|hybrid)\b(?:\s*[-–,/]\s*|\s+)([A-Z][A-Za-z .,\-]{2,40})?/,
    /\b([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+)*,\s*[A-Z]{2})\b/,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const cand = (m[1] || m[0] || '').replace(/\s+/g, ' ').trim()
      if (/remote/i.test(cand) && cand.length <= 12) return 'Remote'
      if (cand.length >= 2 && cand.length <= 60) return cand.slice(0, 60)
    }
  }
  if (/\bremote\b/i.test(text)) return 'Remote'
  return ''
}

/** Heuristic parse when OpenAI is unavailable. */
export function heuristicParseJobPosting(text: string): ParsedJobPosting {
  const raw = text.replace(/\r/g, '').trim()
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)

  let company = ''
  let job_title = ''

  const companyPatterns = [
    /(?:^|\n)\s*(?:company|employer|organization)\s*[:\-–]\s*(.+)/i,
    /(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,60})\s*$/m,
    /^([A-Z][A-Za-z0-9&.\- ]{1,50})\s+is\s+(?:hiring|looking)/im,
  ]
  for (const re of companyPatterns) {
    const m = raw.match(re)
    if (m?.[1]) {
      company = m[1].replace(/\s+/g, ' ').trim().slice(0, 80)
      break
    }
  }

  const titlePatterns = [
    /(?:^|\n)\s*(?:job\s*title|position|role|title)\s*[:\-–]\s*(.+)/i,
    /(?:hiring|seeking|looking for)\s+(?:a|an)\s+([^\n.]{5,80})/i,
    /^([A-Z][^\n]{4,70})\s*$/m,
  ]
  for (const re of titlePatterns) {
    const m = raw.match(re)
    if (m?.[1]) {
      const cand = m[1].replace(/\s+/g, ' ').trim()
      if (!/^(about|responsibilities|requirements|qualifications|benefits)/i.test(cand)) {
        job_title = cand.slice(0, 100)
        break
      }
    }
  }

  if (!job_title && lines[0] && lines[0].length < 90) {
    job_title = lines[0]
  }

  const projects: string[] = []
  const projectRe =
    /(?:project|product|platform|team|working on|owning)\s+["']?([A-Z][A-Za-z0-9 &\-/.]{2,50})/gi
  let pm: RegExpExecArray | null
  while ((pm = projectRe.exec(raw)) !== null) {
    projects.push(pm[1])
  }

  const responsibilities: string[] = []
  const bulletLines = lines.filter((l) => /^[-•*·]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
  for (const b of bulletLines.slice(0, 8)) {
    responsibilities.push(b.replace(/^[-•*·]\s+/, '').replace(/^\d+[.)]\s+/, '').slice(0, 160))
  }

  const location = heuristicLocation(raw)
  const uniqProjects = uniqTrim(projects, 8)
  const uniqResponsibilities = uniqTrim(responsibilities, 8)
  const job_description =
    firstPersonRoleSummary({
      job_title,
      company,
      projects: uniqProjects,
      responsibilities: uniqResponsibilities,
      location,
    }) || raw.slice(0, 400)

  const search_titles = seniorVariants(job_title)
  // Keep keywords light: exact projects first, a few summary tokens
  const search_keywords = uniqTrim(
    [...uniqProjects.slice(0, 2), ...lightSearchHintsFromSummary(job_description)],
    5,
  )

  return {
    company,
    job_title,
    job_description,
    location,
    projects: uniqProjects,
    responsibilities: uniqResponsibilities,
    search_titles,
    search_keywords,
  }
}

export async function parseJobPostingWithAi(
  text: string,
): Promise<ParsedJobPosting> {
  const clipped = text.trim().slice(0, 12000)
  if (!clipped) {
    return heuristicParseJobPosting('')
  }

  if (!Deno.env.get('OPENAI_API_KEY')) {
    return heuristicParseJobPosting(clipped)
  }

  try {
    const msg = await openaiChatRaw(
      [
        {
          role: 'system',
          content: `Extract structured fields from a pasted job application / job description.
Return JSON only with keys:
company (string),
job_title (string),
location (string — city/region/country or Remote/Hybrid if stated; empty string if unknown),
job_description (string — 1-3 sentences in FIRST PERSON as if YOU are the job seeker who applied, e.g. "I applied for the … role at … on the … project…"),
projects (string array: named teams/products/projects — prefer exact proper names),
responsibilities (string array: key duties, max 8),
search_titles (string array: LinkedIn titles to find — exact role, more senior versions, nearby technical leads/managers on the same team — NOT recruiters/HR),
search_keywords (string array: 2-5 LIGHT keywords only — exact project/team names plus a couple distinctive tech terms from the role; do not dump the whole JD).
Prefer technical ICs and seniors who own the work described. If company, title, or location is unclear, use empty string.`,
        },
        { role: 'user', content: clipped },
      ],
      {
        temperature: 0.2,
        response_format: { type: 'json_object' },
      },
    )

    const content = typeof msg.content === 'string' ? msg.content : ''
    const parsed = JSON.parse(content || '{}') as Partial<ParsedJobPosting>
    const fallback = heuristicParseJobPosting(clipped)

    const job_title = String(parsed.job_title || fallback.job_title || '').trim()
    const company = String(parsed.company || fallback.company || '').trim()
    const location = String(parsed.location || fallback.location || '').trim().slice(0, 80)
    let job_description = String(
      parsed.job_description || fallback.job_description || '',
    )
      .trim()
      .slice(0, 600)

    // Ensure first-person voice if the model slipped into third person
    if (job_description && !/^i\b/i.test(job_description)) {
      job_description =
        firstPersonRoleSummary({
          job_title,
          company,
          projects: Array.isArray(parsed.projects)
            ? parsed.projects.map(String)
            : fallback.projects,
          responsibilities: Array.isArray(parsed.responsibilities)
            ? parsed.responsibilities.map(String)
            : fallback.responsibilities,
          location,
        }) || job_description
    }

    const projects = uniqTrim(
      [
        ...(Array.isArray(parsed.projects) ? parsed.projects.map(String) : []),
        ...fallback.projects,
      ],
      8,
    )
    const responsibilities = uniqTrim(
      [
        ...(Array.isArray(parsed.responsibilities)
          ? parsed.responsibilities.map(String)
          : []),
        ...fallback.responsibilities,
      ],
      8,
    )
    const search_titles = uniqTrim(
      [
        ...(Array.isArray(parsed.search_titles)
          ? parsed.search_titles.map(String)
          : []),
        ...seniorVariants(job_title),
        ...fallback.search_titles,
      ],
      12,
    )
    const search_keywords = uniqTrim(
      [
        ...(Array.isArray(parsed.search_keywords)
          ? parsed.search_keywords.map(String)
          : []),
        ...projects.slice(0, 2),
        ...lightSearchHintsFromSummary(job_description),
        ...fallback.search_keywords,
      ],
      5,
    )

    return {
      company,
      job_title,
      job_description:
        job_description ||
        firstPersonRoleSummary({
          job_title,
          company,
          projects,
          responsibilities,
          location,
        }),
      location,
      projects,
      responsibilities,
      search_titles,
      search_keywords,
    }
  } catch {
    return heuristicParseJobPosting(clipped)
  }
}

export function formatApplicationJobDescription(parsed: {
  job_title?: string | null
  job_description?: string | null
  company?: string | null
  responsibilities?: string[] | null
  projects?: string[] | null
  location?: string | null
}): string {
  const summary = parsed.job_description?.trim()
  if (summary) {
    if (/^i\b/i.test(summary)) return summary
    return (
      firstPersonRoleSummary({
        job_title: parsed.job_title || undefined,
        company: parsed.company || undefined,
        projects: parsed.projects || undefined,
        responsibilities: parsed.responsibilities || undefined,
        location: parsed.location || undefined,
      }) || summary
    )
  }
  return firstPersonRoleSummary({
    job_title: parsed.job_title || undefined,
    company: parsed.company || undefined,
    projects: parsed.projects || undefined,
    responsibilities: parsed.responsibilities || undefined,
    location: parsed.location || undefined,
  })
}

/** Soft location match for ranking contacts higher when they share the job geo. */
export function locationMatchScore(
  candidateLocation: string | null | undefined,
  targetLocation: string | null | undefined,
): number {
  const a = (candidateLocation || '').toLowerCase().trim()
  const b = (targetLocation || '').toLowerCase().trim()
  if (!a || !b) return 0
  if (a === b) return 10
  if (a.includes(b) || b.includes(a)) return 8
  const aToks = a.split(/[\s,/;|]+/).filter((t) => t.length > 2)
  const bToks = b.split(/[\s,/;|]+/).filter((t) => t.length > 2)
  let hits = 0
  for (const t of bToks) {
    if (aToks.some((x) => x === t || x.includes(t) || t.includes(x))) hits += 1
  }
  if (hits >= 2) return 7
  if (hits === 1) return 4
  if (/\bremote\b/.test(a) && /\bremote\b/.test(b)) return 3
  return 0
}
