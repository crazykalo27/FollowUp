import {
  filterIncludeTitlesAgainstProfile,
  isFounderCeoEntrepreneurTitle,
  messageRequestsDropFounderCeo,
  scrubFounderCeoFromProfileFields,
  withoutFounderCeoEntrepreneur,
} from './peopleTitlePolicy.ts'

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('peopleTitlePolicy', () => {
  it('detects founder/ceo/entrepreneur titles', () => {
    assert.equal(isFounderCeoEntrepreneurTitle('Founder'), true)
    assert.equal(isFounderCeoEntrepreneurTitle('CEO'), true)
    assert.equal(isFounderCeoEntrepreneurTitle('Co-Founder'), true)
    assert.equal(isFounderCeoEntrepreneurTitle('Entrepreneur'), true)
    assert.equal(isFounderCeoEntrepreneurTitle('ASIC Design Engineer'), false)
    assert.equal(isFounderCeoEntrepreneurTitle('Engineering Manager'), false)
  })

  it('detects remove prompts like the user message', () => {
    const msg =
      'can you please update my profile so that founders and ceo and entrepreneur type stuff is gone but focus on asic and cpu design and computer engineering and quantum computing like my resume'
    assert.equal(messageRequestsDropFounderCeo(msg), true)
    assert.equal(messageRequestsDropFounderCeo('add founder titles please'), false)
  })

  it('scrubs People to find (outreach_targets) on drop', () => {
    const scrubbed = scrubFounderCeoFromProfileFields({
      roles: ['ASIC Design Engineer', 'CEO'],
      outreach_targets: [
        'Founder',
        'CEO',
        'Entrepreneur',
        'ASIC Design Engineer',
        'CPU Architect',
      ],
      must_haves: ['Entrepreneur mindset'],
      skills: ['Verilog'],
    })
    assert.deepEqual(scrubbed.outreach_targets, [
      'ASIC Design Engineer',
      'CPU Architect',
    ])
    assert.deepEqual(scrubbed.roles, ['ASIC Design Engineer'])
    assert.deepEqual(scrubbed.must_haves, [])
    assert.deepEqual(scrubbed.skills, ['Verilog'])
  })

  it('strips invented Founder/CEO from include_titles unless profile allows', () => {
    const cleaned = filterIncludeTitlesAgainstProfile(
      [
        'Founder',
        'CEO',
        'ASIC Design Engineer',
        'CPU Design Engineer',
        'Quantum Engineer',
      ],
      {
        outreach_targets: ['ASIC Design Engineer', 'CPU Design Engineer'],
        roles: ['Quantum Computing Engineer'],
      },
    )
    assert.deepEqual(cleaned, [
      'ASIC Design Engineer',
      'CPU Design Engineer',
      'Quantum Engineer',
    ])
    assert.deepEqual(
      withoutFounderCeoEntrepreneur(['Founder', 'Director', 'CEO']),
      ['Director'],
    )
  })
})
