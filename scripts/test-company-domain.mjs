#!/usr/bin/env node
/**
 * Test company domain host filtering + optional live OpenAI domain resolve.
 *
 * Usage:
 *   node scripts/test-company-domain.mjs
 *   OPENAI_API_KEY=sk-... node scripts/test-company-domain.mjs --live
 */

const SKIP_COMPANY_HOST_PARTS = [
  'indeed.',
  'glassdoor.',
  'ziprecruiter.',
  'monster.',
  'wikipedia.',
  'youtube.',
  'twitter.',
  'x.com',
  'facebook.',
  'reddit.',
  'remotive.',
  'adzuna.',
  'linkedin.com/jobs',
  'linkedin.com/pulse',
  'medium.com',
  'arxiv.org',
  'substack.com',
  'ghost.io',
  'blogspot.',
  'wordpress.com',
  'wixsite.com',
  'squarespace.com',
  'notion.site',
  'github.io',
  'beehiiv.com',
  'mailchimp.',
  'feedburner.',
  'techcrunch.com',
  'forbes.com',
  'businessinsider.com',
  'builtin.com',
  'crunchbase.com',
  'pitchbook.com',
  'cbinsights.com',
  'statista.com',
  'g2.com',
  'ycombinator.com',
  'news.ycombinator',
  'quantamagazine.org',
  'thequantuminsider.com',
  'nature.com/articles',
  'science.org',
  'ieee.org',
  'springer.com',
  'researchgate.net',
  'semiconductor-digest.com',
  'venturebeat.com',
  'prnewswire.com',
  'businesswire.com',
  'companiesmarketcap.',
  'companiesmarketcap.com',
  'finance.yahoo.',
  'yahoo.com/finance',
  'stockanalysis.com',
  'macrotrends.net',
  'investing.com',
  'marketwatch.com',
  'nasdaq.com/market-activity',
  'fool.com',
  'seekingalpha.com',
  'etf.com',
  'etfdb.com',
  'listful.com',
  'ranking.',
  'top10.',
  'top100.',
  'wellfound.com/jobs',
  'angel.co/jobs',
  'linkedin.com',
]

function isSkippableCompanyHostOld(host) {
  const h = host.toLowerCase()
  return SKIP_COMPANY_HOST_PARTS.some((p) => h.includes(p))
}

function isSkippableCompanyHost(host) {
  const raw = host.toLowerCase().trim()
  if (!raw) return true
  const hostOnly = raw.replace(/^www\./, '').split('/')[0] || ''
  const withPath = raw.replace(/^www\./, '')

  return SKIP_COMPANY_HOST_PARTS.some((p) => {
    const pat = p.toLowerCase()
    if (pat.includes('/')) return withPath.includes(pat)
    if (pat.endsWith('.')) {
      const label = pat.slice(0, -1)
      if (!label) return false
      return hostOnly.split('.').includes(label)
    }
    return hostOnly === pat || hostOnly.endsWith('.' + pat)
  })
}

function isEmployerCorporateHost(host) {
  const h = host.toLowerCase().replace(/^www\./, '')
  if (!h || isSkippableCompanyHost(h)) return false
  if (h.endsWith('.substack.com') || h === 'substack.com') return false
  if (h.endsWith('.github.io') || h.endsWith('.wordpress.com')) return false
  const parts = h.split('.')
  if (parts.length < 2) return false
  const tld = parts[parts.length - 1]
  if (!/^[a-z]{2,}$/i.test(tld)) return false
  return true
}

const COMPANIES = [
  ['SpaceX', 'spacex.com'],
  ['Netflix', 'netflix.com'],
  ['Box', 'box.com'],
  ['Google', 'google.com'],
  ['Meta', 'meta.com'],
  ['Microsoft', 'microsoft.com'],
  ['Apple', 'apple.com'],
  ['Amazon', 'amazon.com'],
  ['NVIDIA', 'nvidia.com'],
  ['Tesla', 'tesla.com'],
  ['OpenAI', 'openai.com'],
  ['Stripe', 'stripe.com'],
  ['Cloudflare', 'cloudflare.com'],
  ['Intel', 'intel.com'],
  ['AMD', 'amd.com'],
  ['Boeing', 'boeing.com'],
  ['Lockheed Martin', 'lockheedmartin.com'],
]

console.log('=== Host filter regression (old includes vs new boundary match) ===')
let hostFailures = 0
for (const [name, domain] of COMPANIES) {
  const oldBlocked = isSkippableCompanyHostOld(domain)
  const newOk = isEmployerCorporateHost(domain)
  const mark = oldBlocked && newOk ? 'FIXED' : newOk ? 'ok' : 'FAIL'
  if (!newOk) hostFailures++
  console.log(
    `${mark.padEnd(5)} ${name.padEnd(18)} ${domain.padEnd(22)} oldBlocked=${oldBlocked} newEmployer=${newOk}`,
  )
}

const shouldBlock = ['x.com', 'linkedin.com', 'medium.com', 'indeed.com', 'facebook.com', 'crunchbase.com']
console.log('\n=== Should still block publishers ===')
for (const d of shouldBlock) {
  const blocked = !isEmployerCorporateHost(d)
  if (!blocked) hostFailures++
  console.log(`${blocked ? 'ok' : 'FAIL'} block ${d}`)
}

console.log(`\nHost filter failures: ${hostFailures}`)

const live = process.argv.includes('--live')
if (!live) {
  console.log('\nSkip live OpenAI (pass --live with OPENAI_API_KEY to test).')
  process.exit(hostFailures ? 1 : 0)
}

const key = process.env.OPENAI_API_KEY
if (!key) {
  console.error('OPENAI_API_KEY required for --live')
  process.exit(1)
}

async function resolveViaAi(companyName) {
  const prompt = `What is the official primary website domain and the most common employee email @domain for this company?

Company name: ${companyName}

Return JSON only:
{"domain":"example.com","email_domain":"example.com","url":"https://www.example.com","confidence":"high"}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You resolve official company website and email domains. Return valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(body?.error?.message || `OpenAI ${res.status}`)
  const raw = body.choices?.[0]?.message?.content || '{}'
  const parsed = JSON.parse(raw)
  const domain = String(parsed.domain || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
  return { domain, email_domain: parsed.email_domain || domain, raw: parsed }
}

console.log('\n=== Live OpenAI domain resolve ===')
let aiFailures = 0
for (const [name, expected] of COMPANIES) {
  try {
    const { domain, email_domain } = await resolveViaAi(name)
    const employerOk = isEmployerCorporateHost(domain)
    const ok = employerOk && domain.includes(expected.split('.')[0].slice(0, 4))
    if (!employerOk || !domain) aiFailures++
    console.log(
      `${employerOk && domain ? 'ok' : 'FAIL'} ${name.padEnd(18)} → ${domain || 'null'} (@${email_domain || '—'}) expected~${expected}`,
    )
  } catch (e) {
    aiFailures++
    console.log(`FAIL  ${name.padEnd(18)} error: ${e.message}`)
  }
}

console.log(`\nAI resolve failures: ${aiFailures}`)
process.exit(hostFailures || aiFailures ? 1 : 0)
