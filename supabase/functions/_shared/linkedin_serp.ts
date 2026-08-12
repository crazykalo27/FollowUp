/**
 * Extract contact-card fields from LinkedIn *search result* titles/snippets
 * (Bing/Serper SERP) — not by opening LinkedIn profiles.
 *
 * Common formats observed:
 *   Title:  "Nate Hancock - ASIC/FPGA Design Engineer @ SpaceX"
 *           "Jane Doe - Engineering Manager - Acme - Greater Seattle Area | LinkedIn"
 *           "Shipeng Xie - Senior Software Engineer @ Stripe"
 *   Snippet: "… · Experience: SpaceX · Education: University of Washington · Location: Greater Seattle Area ·"
 */
import { openaiChat } from './cors.ts'
import {
  looksLikeLocationString,
  parseLocationFromLinkedInSnippet,
  parseLocationFromLinkedInTitle,
} from './linkedin_location.ts'

export type LinkedInSerpCard = {
  full_name: string | null
  person_title: string | null
  location: string | null
  experience_company: string | null
  education: string | null
  source: 'heuristic' | 'openai' | 'mixed'
}

function companyKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripLinkedInSuffix(raw: string): string {
  return raw
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
}

function looksLikePersonName(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 80) return false
  if (/https?:\/\//i.test(t) || /linkedin\.com/i.test(t)) return false
  if (/\b(engineer|manager|director|student|intern|recruiter|scientist)\b/i.test(t)) {
    return false
  }
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length < 2 || parts.length > 5) return false
  // Mostly capitalized tokens (allow initials)
  const caps = parts.filter((p) => /^[A-ZÀ-ÿ]/.test(p) || /^[A-Z]\.$/.test(p))
  return caps.length >= Math.ceil(parts.length * 0.6)
}

/** Strip trailing " @ Company" / " at Company" (and optional | fluff). */
export function stripEmployerSuffix(
  role: string,
  companyName?: string | null,
): string {
  let s = role.trim()
  s = s.replace(/\s*[|·].*$/, '').trim()
  s = s.replace(/\s+[@＠]\s*[^|·]+$/u, '').trim()
  s = s.replace(/\s+\bat\s+[^|·]+$/i, '').trim()
  if (companyName?.trim()) {
    const c = escapeRegExp(companyName.trim())
    s = s
      .replace(new RegExp(`\\s+[@＠]\\s*${c}\\s*$`, 'iu'), '')
      .replace(new RegExp(`\\s+at\\s+${c}\\s*$`, 'i'), '')
      .trim()
  }
  return s || role.trim()
}

function parseLabeledSnippet(snippet: string): {
  experience: string | null
  education: string | null
  location: string | null
} {
  const raw = snippet.trim()
  if (!raw) {
    return { experience: null, education: null, location: null }
  }

  const experience =
    raw.match(/\bExperience:\s*([^·|\n]+)/i)?.[1]?.trim() || null
  const education =
    raw.match(/\bEducation:\s*([^·|\n]+)/i)?.[1]?.trim() || null
  let location = raw.match(/\bLocation:\s*([^·|\n]+)/i)?.[1]?.trim() || null
  if (location && !looksLikeLocationString(location)) {
    // Still keep labeled Location: values — LinkedIn is usually right
    location = location.slice(0, 96)
  } else if (!location) {
    location = parseLocationFromLinkedInSnippet(raw)
  }

  return {
    experience: experience?.slice(0, 120) || null,
    education: education?.slice(0, 120) || null,
    location: location?.slice(0, 96) || null,
  }
}

/**
 * Deterministic parse of LinkedIn SERP title + snippet into card fields.
 */
export function parseLinkedInSerp(opts: {
  serpTitle: string
  snippet?: string | null
  companyName?: string | null
}): LinkedInSerpCard {
  const companyName = (opts.companyName || '').trim()
  const cleaned = stripLinkedInSuffix(opts.serpTitle || '')
  const labeled = parseLabeledSnippet(opts.snippet || '')

  let full_name: string | null = null
  let person_title: string | null = null
  let location: string | null = labeled.location

  // Pattern A: "Name - Role @ Company" / "Name – Role at Company"
  const atMatch = cleaned.match(
    /^(.+?)\s[-–—]\s(.+?)\s+(?:[@＠]|at)\s+(.+)$/iu,
  )
  if (atMatch) {
    const maybeName = atMatch[1].trim()
    const maybeRole = atMatch[2].trim()
    if (looksLikePersonName(maybeName)) {
      full_name = maybeName
      person_title = stripEmployerSuffix(maybeRole, companyName)
    } else {
      // Headline-only without a clear name: "Role @ Company"
      person_title = stripEmployerSuffix(
        `${maybeName} - ${maybeRole}`,
        companyName,
      )
    }
  }

  // Pattern B: classic dash segments "Name - Title - Company - Location"
  if (!full_name || !person_title) {
    const parts = cleaned
      .split(/\s[-–—]\s/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length > 0) {
      if (!full_name && looksLikePersonName(parts[0])) {
        full_name = parts[0]
      }
      const companyKeyLocal = companyKey(companyName)
      for (let i = full_name ? 1 : 0; i < parts.length; i++) {
        const segment = parts[i]
        const segKey = companyKey(segment)
        if (
          companyKeyLocal &&
          companyKeyLocal.length >= 3 &&
          (segKey === companyKeyLocal ||
            segKey.includes(companyKeyLocal) ||
            companyKeyLocal.includes(segKey))
        ) {
          continue
        }
        if (looksLikeLocationString(segment)) {
          if (!location) location = segment
          continue
        }
        if (!person_title) {
          person_title = stripEmployerSuffix(segment, companyName)
        }
      }
    }
  }

  // Pattern C: whole title is "Role @ Company" (no name)
  if (!person_title && /[@＠]|\bat\s+/i.test(cleaned)) {
    person_title = stripEmployerSuffix(cleaned, companyName)
  }

  if (!location) {
    location =
      parseLocationFromLinkedInTitle(opts.serpTitle, companyName || '') ||
      labeled.location
  }

  // If name still missing, first token line before · in snippet sometimes repeats name — skip (noisy)

  return {
    full_name,
    person_title: person_title || null,
    location: location || null,
    experience_company: labeled.experience,
    education: labeled.education,
    source: 'heuristic',
  }
}

/**
 * When heuristics miss title/location, ask OpenAI to fill from the same SERP text.
 * Does not change who was found — only card fields.
 */
export async function enrichLinkedInSerpWithAi(
  opts: {
    serpTitle: string
    snippet?: string | null
    companyName: string
    heuristic: LinkedInSerpCard
  },
): Promise<LinkedInSerpCard> {
  const base = opts.heuristic
  const needsTitle = !base.person_title || /[@＠]|\bat\s+/i.test(base.person_title)
  const needsLocation = !base.location
  const needsName = !base.full_name
  if (!needsTitle && !needsLocation && !needsName) return base
  if (!Deno.env.get('OPENAI_API_KEY')) return base

  try {
    const raw = await openaiChat(
      [
        {
          role: 'system',
          content: `You extract fields for a hiring outreach contact card from a LinkedIn search result (SERP title + snippet). Return JSON only:
{"full_name":"string|null","person_title":"string|null","location":"string|null","experience_company":"string|null"}
Rules:
- person_title = current job title ONLY (no company, no @Company, no "at Company", no education).
- location = geographic location only (e.g. "Greater Seattle Area"), not a job or school.
- Prefer labeled snippet fields like "Location:" and "Experience:".
- If the SERP says they work at the target company, still omit company from person_title.
- null when unknown. No markdown.`,
        },
        {
          role: 'user',
          content: `Target company (for context): ${opts.companyName}

SERP title:
${opts.serpTitle}

SERP snippet:
${opts.snippet || '(none)'}

Heuristic guess (may be incomplete):
${JSON.stringify(base)}`,
        },
      ],
      { temperature: 0, response_format: { type: 'json_object' } },
    )
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return base
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >
    const aiTitle =
      typeof parsed.person_title === 'string'
        ? stripEmployerSuffix(parsed.person_title, opts.companyName)
        : null
    const aiName =
      typeof parsed.full_name === 'string' && parsed.full_name.trim()
        ? parsed.full_name.trim()
        : null
    const aiLoc =
      typeof parsed.location === 'string' && parsed.location.trim()
        ? parsed.location.trim().slice(0, 96)
        : null
    const aiExp =
      typeof parsed.experience_company === 'string' &&
      parsed.experience_company.trim()
        ? parsed.experience_company.trim().slice(0, 120)
        : null

    return {
      full_name: base.full_name || aiName,
      person_title: needsTitle && aiTitle ? aiTitle : base.person_title || aiTitle,
      location: base.location || aiLoc,
      experience_company: base.experience_company || aiExp,
      education: base.education,
      source: 'mixed',
    }
  } catch {
    return base
  }
}
