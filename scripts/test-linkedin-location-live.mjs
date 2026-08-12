#!/usr/bin/env node
/**
 * Live LinkedIn search → card location extraction test.
 * People were found via live web search this session (SpaceX / Stripe / NVIDIA).
 *
 *   node scripts/test-linkedin-location-live.mjs
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Mirror production parsers (Deno modules aren't importable in plain node)
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
const CC_RE = /\s*\((?:US|UK|CA|EU|AU|IN|DE|FR|NL|IE|SG|JP|BR|MX)\)\s*$/i

function looksLikeJobTitleOrHeadline(text) {
  return JOB_OR_HEADLINE_RE.test(text.trim())
}
function hasStrongGeoSignal(text) {
  return (
    GEO_STRONG_RE.test(text) ||
    /\bGreater\s+[A-Z]/i.test(text) ||
    GEO_TAIL_RE.test(text)
  )
}
function looksLikeLocationString(text) {
  let s = text.trim()
  if (!s || s.length > 96) return false
  s = s.replace(CC_RE, '').trim()
  if (!s) return false
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

function parseLocationFromLinkedInSnippet(snippet) {
  const raw = snippet.trim()
  if (!raw) return null
  const labeled = raw.match(/\bLocation:\s*([^·|\n]+)/i)
  if (labeled?.[1]) {
    const loc = labeled[1].trim().replace(CC_RE, '').trim()
    if (looksLikeLocationString(loc) || looksLikeLocationString(labeled[1])) {
      return loc || labeled[1].trim()
    }
  }
  for (const line of raw.split(/\n+/)) {
    const cleaned = line.trim().replace(CC_RE, '').trim()
    if (looksLikeLocationString(cleaned) || looksLikeLocationString(line.trim())) {
      return cleaned || line.trim()
    }
  }
  const segments = raw.split('·').map((p) => p.trim()).filter(Boolean)
  for (let i = 0; i < segments.length; i++) {
    if (CONNECTIONS_RE.test(segments[i]) && i > 0) {
      const prev = segments[i - 1].replace(CC_RE, '').trim()
      if (looksLikeLocationString(prev) || looksLikeLocationString(segments[i - 1])) {
        return prev || segments[i - 1]
      }
    }
  }
  const skipFirst = segments.length > 2 ? 1 : 0
  for (let i = segments.length - 1; i >= skipFirst; i--) {
    const seg = segments[i]
    if (/^experience:/i.test(seg)) continue
    if (NOISE_SEGMENT_RE.test(seg)) continue
    if (CONNECTIONS_RE.test(seg)) continue
    if (looksLikeJobTitleOrHeadline(seg)) continue
    const cleaned = seg.replace(CC_RE, '').trim()
    if (looksLikeLocationString(cleaned) || looksLikeLocationString(seg)) {
      return cleaned || seg
    }
  }
  return null
}

function stripEmployerSuffix(role, companyName) {
  let s = role.trim().replace(/\s*[|·].*$/, '').trim()
  s = s.replace(/\s+[@＠]\s*[^|·]+$/u, '').trim()
  s = s.replace(/\s+\bat\s+[^|·]+$/i, '').trim()
  return s || role.trim()
}
function looksLikePersonName(s) {
  const t = s.trim()
  if (!t || t.length > 80) return false
  if (/\b(engineer|manager|director|student|intern|recruiter|scientist)\b/i.test(t)) {
    return false
  }
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length < 2 || parts.length > 5) return false
  return parts.filter((p) => /^[A-ZÀ-ÿ]/.test(p)).length >= Math.ceil(parts.length * 0.6)
}
function parseLinkedInSerp({ serpTitle, snippet, companyName }) {
  const cleaned = serpTitle
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
  let location =
    snippet?.match(/\bLocation:\s*([^·|\n]+)/i)?.[1]?.trim().replace(CC_RE, '').trim() ||
    null
  if (!location) location = parseLocationFromLinkedInSnippet(snippet || '')
  let full_name = null
  let person_title = null
  const atMatch = cleaned.match(/^(.+?)\s[-–—]\s(.+?)\s+(?:[@＠]|at)\s+(.+)$/iu)
  if (atMatch && looksLikePersonName(atMatch[1].trim())) {
    full_name = atMatch[1].trim()
    person_title = stripEmployerSuffix(atMatch[2].trim(), companyName)
  }
  if (!full_name || !person_title) {
    const parts = cleaned.split(/\s[-–—]\s/).map((p) => p.trim()).filter(Boolean)
    if (parts[0] && looksLikePersonName(parts[0])) full_name = parts[0]
    for (let i = full_name ? 1 : 0; i < parts.length; i++) {
      const seg = parts[i]
      if (looksLikeLocationString(seg)) {
        if (!location) location = seg.replace(CC_RE, '').trim()
        continue
      }
      if (!person_title) person_title = stripEmployerSuffix(seg, companyName)
    }
  }
  return { full_name, person_title, location }
}

// Live people found via web search this session
const live = [
  {
    company: 'SpaceX',
    serpTitle: 'Nate Hancock - ASIC/FPGA Design Engineer @ SpaceX | LinkedIn',
    snippet:
      'ASIC/FPGA Design Engineer @ SpaceX | Working on StarLink · Experience: SpaceX · Education: University of Washington · Location: Greater Seattle Area ·',
    expectLoc: /Seattle/i,
  },
  {
    company: 'SpaceX',
    serpTitle: 'Nate Hancock - ASIC/FPGA Design Engineer @ SpaceX',
    snippet:
      'ASIC/FPGA Design Engineer @ SpaceX | Working on StarLink\nGreater Seattle Area (US)\nExperience: SpaceX',
    expectLoc: /Seattle/i,
  },
  {
    company: 'SpaceX',
    serpTitle: 'Yash Parakh - ASIC/FPGA Engineer at SpaceX | LinkedIn',
    snippet:
      'Designing the next generation of Starlink ASICs. · Experience: SpaceX · Location: Austin, Texas Metropolitan Area ·',
    expectLoc: /Austin/i,
  },
  {
    company: 'SpaceX',
    serpTitle: 'Alexander Fusco - ASIC/FPGA Design Engineer at SpaceX | LinkedIn',
    snippet:
      'ASIC FPGA Design Engineer II · Experience: SpaceX · Location: Greater Seattle Area ·',
    expectLoc: /Seattle/i,
  },
  {
    company: 'Stripe',
    serpTitle: 'Jonathan Cheng - Software Engineer @ Stripe | LinkedIn',
    snippet:
      'SWE at Stripe · Experience: Stripe · Location: New York City Metropolitan Area ·',
    expectLoc: /New York/i,
  },
  {
    company: 'Stripe',
    serpTitle: 'Hao Zhang - Software Engineer at Stripe | LinkedIn',
    snippet:
      'Software Engineer at Stripe · Experience: Stripe · Location: San Francisco Bay Area ·',
    expectLoc: /San Francisco|Bay Area/i,
  },
  {
    company: 'NVIDIA',
    serpTitle: 'Gunjot Kaur - Design Engineer - NVIDIA - San Francisco Bay Area | LinkedIn',
    snippet:
      'Design Engineer at NVIDIA · Experience: NVIDIA · Location: San Francisco Bay Area ·',
    expectLoc: /San Francisco|Bay Area/i,
  },
]

let pass = 0
let fail = 0
console.log('Live LinkedIn location extraction\n')
for (const row of live) {
  const got = parseLinkedInSerp(row)
  const ok = Boolean(got.location && row.expectLoc.test(got.location))
  if (ok) pass++
  else fail++
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${row.company.padEnd(7)} ${(got.full_name || '?').padEnd(18)} ${(got.person_title || '?').padEnd(28)} loc=${JSON.stringify(got.location)}`,
  )
}
console.log(`\n${pass}/${live.length} locations extracted correctly (${fail} failed)`)
process.exit(fail ? 1 : 0)
