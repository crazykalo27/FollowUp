#!/usr/bin/env node
/**
 * Smoke tests for temporary retry loosen helpers.
 * Run: node --experimental-strip-types supabase/functions/_shared/retryLoosen.test.mjs
 * (inlined here so we don't need Deno for CI smoke)
 */

const LOOSEN_STRENGTH = 0.15
const LOOSEN_ASPECTS = [
  'broad_titles',
  'dept_niche',
  'title_match',
  'location_focus',
]

function atLeastOne(n) {
  return Math.max(1, n)
}
function countFor(size) {
  return atLeastOne(Math.ceil(size * LOOSEN_STRENGTH))
}
function pickLoosenAspect(tried) {
  const left = LOOSEN_ASPECTS.filter((a) => !tried.includes(a))
  if (!left.length) return null
  return left[0]
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

assert(countFor(4) === 1, '15% of 4 → 1')
assert(countFor(10) === 2, '15% of 10 → 2')
assert(pickLoosenAspect([]) === 'broad_titles', 'first unused')
assert(pickLoosenAspect(['broad_titles', 'dept_niche', 'title_match', 'location_focus']) === null, 'all used')
assert(pickLoosenAspect(['broad_titles']) === 'dept_niche', 'skip tried')

console.log('retryLoosen smoke ok')
