#!/usr/bin/env node
/**
 * Fixture tests for LinkedIn SERP → contact card extraction.
 * Samples mirror real Bing/Google LinkedIn result shapes.
 *
 *   node scripts/test-linkedin-serp.mjs
 */

function companyKey(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function looksLikeLocationString(s) {
  const t = s.trim()
  if (!t || t.length > 96) return false
  if (/\bGreater\s+[A-Z]/i.test(t)) return true
  if (/\b(Area|Region|Metropolitan|County)\b/i.test(t)) return true
  if (/,\s*[A-Z]{2}\b/.test(t)) return true
  return false
}

function looksLikePersonName(s) {
  const t = s.trim()
  if (!t || t.length > 80) return false
  if (/\b(engineer|manager|director|student|intern|recruiter|scientist)\b/i.test(t)) {
    return false
  }
  const parts = t.split(/\s+/).filter(Boolean)
  if (parts.length < 2 || parts.length > 5) return false
  const caps = parts.filter((p) => /^[A-ZÀ-ÿ]/.test(p) || /^[A-Z]\.$/.test(p))
  return caps.length >= Math.ceil(parts.length * 0.6)
}

function stripEmployerSuffix(role, companyName) {
  let s = role.trim()
  s = s.replace(/\s*[|·].*$/, '').trim()
  s = s.replace(/\s+[@＠]\s*[^|·]+$/u, '').trim()
  s = s.replace(/\s+\bat\s+[^|·]+$/i, '').trim()
  if (companyName?.trim()) {
    const c = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    s = s
      .replace(new RegExp(`\\s+[@＠]\\s*${c}\\s*$`, 'iu'), '')
      .replace(new RegExp(`\\s+at\\s+${c}\\s*$`, 'i'), '')
      .trim()
  }
  return s || role.trim()
}

function parseLinkedInSerp({ serpTitle, snippet, companyName }) {
  const cleaned = serpTitle
    .replace(/\s*\|\s*LinkedIn.*$/i, '')
    .replace(/\s*-\s*LinkedIn.*$/i, '')
    .trim()
  const experience =
    snippet?.match(/\bExperience:\s*([^·|\n]+)/i)?.[1]?.trim() || null
  const education =
    snippet?.match(/\bEducation:\s*([^·|\n]+)/i)?.[1]?.trim() || null
  let location = snippet?.match(/\bLocation:\s*([^·|\n]+)/i)?.[1]?.trim() || null

  let full_name = null
  let person_title = null

  const atMatch = cleaned.match(
    /^(.+?)\s[-–—]\s(.+?)\s+(?:[@＠]|at)\s+(.+)$/iu,
  )
  if (atMatch) {
    const maybeName = atMatch[1].trim()
    const maybeRole = atMatch[2].trim()
    if (looksLikePersonName(maybeName)) {
      full_name = maybeName
      person_title = stripEmployerSuffix(maybeRole, companyName)
    }
  }

  if (!full_name || !person_title) {
    const parts = cleaned.split(/\s[-–—]\s/).map((p) => p.trim()).filter(Boolean)
    if (parts.length > 0) {
      if (!full_name && looksLikePersonName(parts[0])) full_name = parts[0]
      const companyKeyLocal = companyKey(companyName || '')
      for (let i = full_name ? 1 : 0; i < parts.length; i++) {
        const segment = parts[i]
        const segKey = companyKey(segment)
        if (
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

  return { full_name, person_title, location, experience, education }
}

const fixtures = [
  {
    company: 'SpaceX',
    serpTitle: 'Nate Hancock - ASIC/FPGA Design Engineer @ SpaceX',
    snippet:
      'Electrical Engineering student interested in VLSI and semiconductor devices, specifically… · Experience: SpaceX · Education: University of Washington · Location: Greater Seattle Area ·',
    expect: {
      full_name: 'Nate Hancock',
      person_title: 'ASIC/FPGA Design Engineer',
      location: 'Greater Seattle Area',
      experience: 'SpaceX',
    },
  },
  {
    company: 'SpaceX',
    serpTitle: 'Nicholas Kroetsch - Senior ASIC Design Engineer @ SpaceX | LinkedIn',
    snippet: 'Developing the next generation of Starlink ASICs · Experience: SpaceX · Location: Irvine, CA ·',
    expect: {
      full_name: 'Nicholas Kroetsch',
      person_title: 'Senior ASIC Design Engineer',
      location: 'Irvine, CA',
    },
  },
  {
    company: 'Stripe',
    serpTitle: 'Shipeng Xie - Senior Software Engineer @ Stripe | LinkedIn',
    snippet:
      'Software Engineer at Stripe, formerly VMware · Experience: Stripe · Location: South San Francisco, California, United States ·',
    expect: {
      full_name: 'Shipeng Xie',
      person_title: 'Senior Software Engineer',
      location: 'South San Francisco, California, United States',
    },
  },
  {
    company: 'NVIDIA',
    serpTitle: 'Gunjot Kaur - Design Engineer - NVIDIA - San Francisco Bay Area | LinkedIn',
    snippet: 'Design Engineer at NVIDIA · Experience: NVIDIA · Location: San Francisco Bay Area ·',
    expect: {
      full_name: 'Gunjot Kaur',
      person_title: 'Design Engineer',
      location: 'San Francisco Bay Area',
    },
  },
  {
    company: 'Stripe',
    serpTitle: 'Kevin Li - Software Engineer at Stripe | LinkedIn',
    snippet: "I'm a Software Engineer currently at Stripe · Location: New York, New York, United States ·",
    expect: {
      full_name: 'Kevin Li',
      person_title: 'Software Engineer',
      location: 'New York, New York, United States',
    },
  },
]

let failures = 0
for (const f of fixtures) {
  const got = parseLinkedInSerp({
    serpTitle: f.serpTitle,
    snippet: f.snippet,
    companyName: f.company,
  })
  const checks = [
    ['full_name', f.expect.full_name, got.full_name],
    ['person_title', f.expect.person_title, got.person_title],
    ['location', f.expect.location, got.location],
  ]
  if (f.expect.experience) {
    checks.push(['experience', f.expect.experience, got.experience])
  }
  let ok = true
  for (const [field, exp, actual] of checks) {
    if (actual !== exp) {
      ok = false
      console.log(`FAIL ${f.expect.full_name || f.serpTitle} ${field}: got ${JSON.stringify(actual)} expected ${JSON.stringify(exp)}`)
    }
  }
  if (ok) console.log(`ok   ${got.full_name} → ${got.person_title} @ ${f.company} · ${got.location}`)
  else failures++
}

console.log(`\nFailures: ${failures}`)
process.exit(failures ? 1 : 0)
