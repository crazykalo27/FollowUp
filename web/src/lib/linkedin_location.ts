/** Heuristics for LinkedIn SERP snippets — keep in sync with supabase/functions/_shared/linkedin_location.ts */

const PROSE_RE =
  /\b(I'?m|I am|I have|I help|we help|passionate|experienced|looking for|years of|seeking|building|leading|specializ|focused on|working on|helping|creating|transforming|delivering|driving|enabling)\b/i
const NOISE_SEGMENT_RE =
  /^(experience|education|about|skills|licenses|certifications|volunteer|recommendations|activity|interests)\b/i
const CONNECTIONS_RE = /\d+\+?\s*connections|followers on linkedin/i

const JOB_OR_HEADLINE_RE =
  /\b(engineer|engineering|developer|manager|director|lead|head of|chief|vp\b|vice president|president|analyst|consultant|specialist|coordinator|associate|senior|staff|principal|architect|designer|scientist|researcher|recruiter|talent|product|marketing|sales|operations|finance|legal|human resources|\bhr\b|software|hardware|data|machine learning|\bml\b|\bai\b|\bnlp\b|cloud|platform|infrastructure|devops|sre|security|\bux\b|\bui\b|full[- ]stack|front[- ]end|back[- ]end|mobile|ios|android|\bqa\b|test|support|administrator|executive|founder|co-founder|\bcto\b|\bceo\b|\bcfo\b|\bcmo\b|partner|advisor|intern|student|professor|teacher|writer|editor|strategist|owner|technologist|programmer|research|development|\br&d\b|hardware|firmware|embedded|systems|solutions|services|consulting|practice|team|department|division|group|office of)\b/i

const GEO_STRONG_RE =
  /\b(Area|Region|Metropolitan|County|Province|Territory|District|Canton|Prefecture)\b/i

const US_STATES =
  'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming'

const US_STATE_ABBR =
  'AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY'

const GEO_TAIL_RE = new RegExp(
  `\\b(${US_STATES}|${US_STATE_ABBR}|United States|USA|U\\.S\\.|UK|United Kingdom|Canada|Germany|France|India|Australia|Netherlands|Spain|Italy|Brazil|Mexico|Singapore|Ireland|Sweden|Norway|Denmark|Finland|Switzerland|Belgium|Austria|Poland|Israel|Japan|China|South Korea|Taiwan|Hong Kong|New Zealand|Portugal|Czech Republic|Romania|Hungary|Colombia|Argentina|Chile|United Arab Emirates|UAE|Saudi Arabia|South Africa|Remote)\\b`,
  'i',
)

function looksLikeJobTitleOrHeadline(text: string): boolean {
  const s = text.trim()
  if (!s) return false
  if (JOB_OR_HEADLINE_RE.test(s)) return true
  if (/,/.test(s)) {
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 2 && parts.every((p) => JOB_OR_HEADLINE_RE.test(p))) {
      return true
    }
  }
  return false
}

function hasStrongGeoSignal(text: string): boolean {
  if (GEO_STRONG_RE.test(text)) return true
  if (/\bGreater\s+[A-Z]/i.test(text)) return true
  if (GEO_TAIL_RE.test(text)) return true
  return false
}

export function looksLikeLocationString(text: string): boolean {
  const s = text.trim()
  if (!s || s.length > 96) return false
  if (PROSE_RE.test(s)) return false
  if (NOISE_SEGMENT_RE.test(s)) return false
  if (CONNECTIONS_RE.test(s)) return false
  if (/https?:\/\/|@|linkedin\.com/i.test(s)) return false
  if (/\b(inc\.|llc|ltd\.|corp\.)\b/i.test(s)) return false

  const words = s.split(/\s+/).filter(Boolean)
  if (words.length > 10 && !GEO_STRONG_RE.test(s)) return false

  if (GEO_STRONG_RE.test(s) || /\bGreater\s+[A-Z]/i.test(s)) {
    return !looksLikeJobTitleOrHeadline(s)
  }

  if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]*,\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]+/.test(s)) {
    const parts = s.split(',').map((p) => p.trim())
    if (parts.length >= 2 && parts.length <= 4) {
      if (looksLikeJobTitleOrHeadline(s)) return false
      const last = parts[parts.length - 1]
      if (last.length <= 40 && !PROSE_RE.test(last) && hasStrongGeoSignal(s)) {
        return true
      }
    }
  }

  if (words.length <= 4 && hasStrongGeoSignal(s) && !looksLikeJobTitleOrHeadline(s)) {
    return true
  }

  return false
}

export function parseLocationFromLinkedInTitle(
  title: string,
  companyName: string,
): string | null {
  const cleaned = title
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
  const parts = cleaned.split(/\s[-–—]\s/).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const companyLower = companyName.toLowerCase()
  const tail = parts.slice(Math.max(1, parts.length - 2))
  for (let i = tail.length - 1; i >= 0; i--) {
    const segment = tail[i]
    if (segment.toLowerCase() === companyLower) continue
    if (looksLikeLocationString(segment)) return segment
  }
  return null
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

  const skipFirst = segments.length > 2 ? 1 : 0
  for (let i = segments.length - 1; i >= skipFirst; i--) {
    const seg = segments[i]
    if (/^experience:/i.test(seg)) continue
    if (NOISE_SEGMENT_RE.test(seg)) continue
    if (CONNECTIONS_RE.test(seg)) continue
    if (looksLikeJobTitleOrHeadline(seg)) continue
    if (looksLikeLocationString(seg)) return seg
  }

  return null
}
