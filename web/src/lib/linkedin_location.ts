/** Heuristics for LinkedIn SERP snippets — keep in sync with supabase/functions/_shared/linkedin_location.ts */

const PROSE_RE =
  /\b(I'?m|I am|I have|I help|we help|passionate|experienced|looking for|years of|seeking|building|leading|specializ)/i
const NOISE_SEGMENT_RE =
  /^(experience|education|about|skills|licenses|certifications|volunteer|recommendations|activity|interests)\b/i
const CONNECTIONS_RE = /\d+\+?\s*connections|followers on linkedin/i

export function looksLikeLocationString(text: string): boolean {
  const s = text.trim()
  if (!s || s.length > 96) return false
  if (PROSE_RE.test(s)) return false
  if (NOISE_SEGMENT_RE.test(s)) return false
  if (CONNECTIONS_RE.test(s)) return false
  if (/https?:\/\/|@|linkedin\.com/i.test(s)) return false
  if (/\b(inc\.|llc|ltd\.|corp\.)\b/i.test(s)) return false

  const words = s.split(/\s+/).filter(Boolean)
  if (words.length > 10 && !/\b(Metropolitan|Greater)\b/i.test(s)) return false

  if (/\b(Area|Region|Metropolitan|County|Province|Territory)\b/i.test(s)) {
    return true
  }
  if (/\bGreater\s+[A-Z]/i.test(s)) return true

  if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]*,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]+/.test(s)) {
    const parts = s.split(',').map((p) => p.trim())
    if (parts.length >= 2 && parts.length <= 4) {
      const last = parts[parts.length - 1]
      if (last.length <= 40 && !PROSE_RE.test(last)) return true
    }
  }

  return false
}

export function parseLocationFromLinkedInSnippet(snippet: string): string | null {
  const raw = snippet.trim()
  if (!raw) return null

  const labeled = raw.match(/\bLocation:\s*([^·|\n]+)/i)
  if (labeled?.[1] && looksLikeLocationString(labeled[1])) {
    return labeled[1].trim()
  }

  const segments = raw.split('·').map((p) => p.trim()).filter(Boolean)
  for (let i = 0; i < segments.length; i++) {
    if (CONNECTIONS_RE.test(segments[i]) && i > 0) {
      const prev = segments[i - 1]
      if (looksLikeLocationString(prev)) return prev
    }
  }

  for (const seg of segments) {
    if (/^experience:/i.test(seg)) continue
    if (NOISE_SEGMENT_RE.test(seg)) continue
    if (CONNECTIONS_RE.test(seg)) continue
    if (looksLikeLocationString(seg)) return seg
  }

  const geo =
    raw.match(
      /\b([A-Z][\w .'-]{1,48},\s*[A-Z][\w .'-]{1,48}(?:,\s*[A-Z][\w .'-]{1,48})?)\b/,
    )?.[1]
  if (geo && looksLikeLocationString(geo)) return geo.trim()

  return null
}
