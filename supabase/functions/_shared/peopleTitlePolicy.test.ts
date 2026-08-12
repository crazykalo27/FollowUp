import {
  applyTitleTuningToIncludes,
  asTermList,
  ensureProfileAdditions,
  itemMatchesTerm,
  preferProfileAlignedIncludes,
  scrubProfileByRemoveTerms,
  withoutMatchingTerms,
} from './peopleTitlePolicy.ts'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('peopleTitlePolicy (general tuning)', () => {
  it('matches and strips arbitrary remove terms', () => {
    assert.equal(itemMatchesTerm('ASIC Design Engineer', 'ASIC'), true)
    assert.equal(itemMatchesTerm('Gallery Curator', 'painting'), false)
    assert.deepEqual(
      withoutMatchingTerms(
        ['ASIC Design Engineer', 'CPU Architect', 'Gallery Curator'],
        ['ASIC', 'CPU'],
      ),
      ['Gallery Curator'],
    )
  })

  it('scrubs founder/ceo when those are the remove_terms (synonym expand)', () => {
    const scrubbed = scrubProfileByRemoveTerms(
      {
        roles: ['ASIC Design Engineer', 'CEO'],
        outreach_targets: [
          'Founder',
          'CEO',
          'Entrepreneur',
          'ASIC Design Engineer',
        ],
        must_haves: ['Entrepreneurship'],
        skills: ['Verilog'],
      },
      ['founder', 'CEO', 'entrepreneur'],
    )
    assert.deepEqual(scrubbed.outreach_targets, ['ASIC Design Engineer'])
    assert.deepEqual(scrubbed.roles, ['ASIC Design Engineer'])
    assert.deepEqual(scrubbed.must_haves, [])
  })

  it('can remove technical and add painting-style targets', () => {
    const removed = scrubProfileByRemoveTerms(
      {
        roles: ['ASIC Design Engineer', 'CPU Design Engineer'],
        industries: ['Quantum Computing', 'Semiconductors'],
        outreach_targets: [
          'ASIC Design Engineer',
          'Engineering Manager',
          'CPU Architect',
        ],
      },
      ['ASIC', 'CPU', 'quantum', 'semiconductor', 'technical', 'engineering'],
    )
    const added = ensureProfileAdditions(removed, [
      'Painting',
      'Gallery Curator',
      'Studio Artist',
    ])
    assert.ok(added.industries?.includes('Painting'))
    assert.ok(added.roles?.includes('Gallery Curator'))
    assert.ok(added.outreach_targets?.includes('Gallery Curator'))
    assert.ok(added.outreach_targets?.includes('Studio Artist'))
    assert.equal(
      (added.outreach_targets || []).some((t) => /ASIC|CPU/i.test(t)),
      false,
    )
  })

  it('tunes include_titles with ban + prefer terms', () => {
    const tuned = applyTitleTuningToIncludes(
      ['Founder', 'CEO', 'ASIC Design Engineer', 'Engineering Manager'],
      {
        banTerms: asTermList(['Founder', 'CEO']),
        preferTerms: asTermList(['Gallery Curator', 'Painter']),
      },
    )
    assert.deepEqual(tuned, [
      'ASIC Design Engineer',
      'Engineering Manager',
      'Gallery Curator',
      'Painter',
    ])
  })

  it('aligns includes to scrubbed outreach/roles', () => {
    const includes = preferProfileAlignedIncludes(
      ['Founder', 'CEO', 'Random VP'],
      {
        outreach_targets: ['Gallery Curator', 'Studio Artist'],
        roles: ['Painter'],
      },
      ['Founder', 'CEO'],
    )
    assert.equal(includes.includes('Founder'), false)
    assert.equal(includes.includes('CEO'), false)
    assert.ok(includes.includes('Gallery Curator'))
    assert.ok(includes.includes('Studio Artist'))
  })
})
