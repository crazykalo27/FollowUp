import { openaiChatRaw } from './cors.ts'

export type ParsedJobPosting = {
  company: string
  job_title: string
  /** Concise role summary for emails / hiring signal */
  job_description: string
  /** Teams, products, or named projects from the posting */
  projects: string[]
  /** Specific responsibilities / focus areas */
  responsibilities: string[]
  /** Titles to search for (exact role + senior / nearby technical) */
  search_titles: string[]
  /** Keywords for LinkedIn dept / project queries */
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
    // Nearby management for referral outreach
    const base = t.replace(/^(senior|staff|principal|lead)\s+/i, '').trim()
    if (base) {
      out.push(`${base} Manager`, `Engineering Manager`)
    }
  }
  // Soften overly long titles for search
  if (lower.includes('software engineer')) {
    out.push('Software Engineer', 'Senior Software Engineer', 'Staff Software Engineer')
  }
  return uniqTrim(out, 10)
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

  const summaryBits = [
    job_title || null,
    company ? `at ${company}` : null,
    responsibilities[0] || null,
  ].filter(Boolean)
  const job_description =
    summaryBits.join(' — ').slice(0, 400) ||
    raw.slice(0, 400)

  const search_titles = seniorVariants(job_title)
  const search_keywords = uniqTrim(
    [...projects, ...responsibilities.map((r) => r.split(/\s+/).slice(0, 4).join(' '))],
    8,
  )

  return {
    company,
    job_title,
    job_description,
    projects: uniqTrim(projects, 8),
    responsibilities: uniqTrim(responsibilities, 8),
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
company (string), job_title (string), job_description (string, 1-3 sentence summary of the exact role for an outreach email),
projects (string array: named teams/products/projects),
responsibilities (string array: key duties, max 8),
search_titles (string array: LinkedIn titles to find — exact role, more senior versions of that role, nearby technical leads/managers on the same team — NOT recruiters/HR),
search_keywords (string array: team/project/tech keywords for people search).
Prefer technical ICs and seniors who own the work described. If company or title is unclear, use empty string.`,
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
    const job_description = String(
      parsed.job_description || fallback.job_description || '',
    )
      .trim()
      .slice(0, 600)

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
        ...projects,
        ...fallback.search_keywords,
      ],
      10,
    )

    return {
      company,
      job_title,
      job_description:
        job_description ||
        [job_title, company ? `at ${company}` : ''].filter(Boolean).join(' '),
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
}): string {
  const title = parsed.job_title?.trim()
  const summary = parsed.job_description?.trim()
  if (summary) return summary
  const bits = [
    title || null,
    parsed.company ? `at ${parsed.company}` : null,
    parsed.projects?.length ? `projects: ${parsed.projects.slice(0, 3).join(', ')}` : null,
    parsed.responsibilities?.[0] || null,
  ].filter(Boolean)
  return bits.join(' — ') || ''
}
