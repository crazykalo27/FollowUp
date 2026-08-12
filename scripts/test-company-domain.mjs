#!/usr/bin/env node
/**
 * Test hostname shape checks + optional live OpenAI domain resolve.
 *
 * Usage:
 *   node scripts/test-company-domain.mjs
 *   OPENAI_API_KEY=sk-... node scripts/test-company-domain.mjs --live
 */

function isEmployerCorporateHost(host) {
  const h = host.toLowerCase().replace(/^www\./, '').split('/')[0] || ''
  if (!h || !h.includes('.')) return false
  const parts = h.split('.')
  if (parts.length < 2) return false
  if (parts.some((p) => !p || !/^[a-z0-9-]+$/i.test(p))) return false
  const tld = parts[parts.length - 1]
  if (!/^[a-z]{2,}$/i.test(tld)) return false
  return true
}

const COMPANIES = [
  ['SpaceX', 'spacex.com'],
  ['YouTube', 'youtube.com'],
  ['Facebook', 'facebook.com'],
  ['Meta', 'meta.com'],
  ['Netflix', 'netflix.com'],
  ['Box', 'box.com'],
  ['Google', 'google.com'],
  ['Microsoft', 'microsoft.com'],
  ['Apple', 'apple.com'],
  ['Amazon', 'amazon.com'],
  ['NVIDIA', 'nvidia.com'],
  ['Tesla', 'tesla.com'],
  ['OpenAI', 'openai.com'],
  ['X', 'x.com'],
  ['LinkedIn', 'linkedin.com'],
]

console.log('=== Hostname shape (no publisher denylist) ===')
let failures = 0
for (const [name, domain] of COMPANIES) {
  const ok = isEmployerCorporateHost(domain)
  if (!ok) failures++
  console.log(`${ok ? 'ok' : 'FAIL'} ${name.padEnd(18)} ${domain}`)
}

for (const bad of ['nota domain', 'localhost', '', 'com']) {
  const ok = !isEmployerCorporateHost(bad)
  if (!ok) failures++
  console.log(`${ok ? 'ok' : 'FAIL'} reject ${JSON.stringify(bad)}`)
}

console.log(`\nShape failures: ${failures}`)

const live = process.argv.includes('--live')
if (!live) {
  console.log('\nSkip live OpenAI (pass --live with OPENAI_API_KEY to test).')
  process.exit(failures ? 1 : 0)
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
  return { domain, email_domain: parsed.email_domain || domain }
}

console.log('\n=== Live OpenAI domain resolve ===')
let aiFailures = 0
for (const [name, expected] of COMPANIES) {
  try {
    const { domain, email_domain } = await resolveViaAi(name)
    const ok = isEmployerCorporateHost(domain)
    if (!ok || !domain) aiFailures++
    console.log(
      `${ok && domain ? 'ok' : 'FAIL'} ${name.padEnd(18)} → ${domain || 'null'} (@${email_domain || '—'}) expected~${expected}`,
    )
  } catch (e) {
    aiFailures++
    console.log(`FAIL  ${name.padEnd(18)} error: ${e.message}`)
  }
}

console.log(`\nAI resolve failures: ${aiFailures}`)
process.exit(failures || aiFailures ? 1 : 0)
