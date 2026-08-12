#!/usr/bin/env node
/**
 * Test hostname shape checks used by domain resolve.
 *
 * Production domain resolve uses OpenAI + Bing/Serper web_search tool
 * (see supabase/functions/_shared/companyDomain.ts).
 *
 * Usage:
 *   node scripts/test-company-domain.mjs
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
console.log(
  '\nLive domain resolve needs OpenAI + Bing/Serper inside run-search; skipped here.',
)
process.exit(failures ? 1 : 0)
