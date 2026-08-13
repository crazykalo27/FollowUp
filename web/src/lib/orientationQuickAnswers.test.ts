import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  detectQuestionKeyFromText,
  orientationQuickOptions,
} from '../lib/orientationQuickAnswers.ts'

describe('orientation question chips', () => {
  it('maps experience question to Entry/Mid-level/Experienced, not company size', () => {
    const msg =
      'Got it.\n\nAre you looking for entry, mid-level, or experienced positions?\n\nType or press the buttons below to respond.'
    assert.equal(detectQuestionKeyFromText(msg), 'seniority')
    assert.deepEqual(orientationQuickOptions({ orientation_q: 3 }, false, msg), [
      'Entry',
      'Mid-level',
      'Experienced',
    ])
  })

  it('maps company size question to Large/Medium/Small', () => {
    const msg =
      'Are you looking for large, medium, or small company size — or no preference?\n\nType or press the buttons below to respond.'
    assert.equal(detectQuestionKeyFromText(msg), 'company_size')
    assert.deepEqual(orientationQuickOptions({ orientation_q: 4 }, false, msg), [
      'Large',
      'Medium',
      'Small',
      'No preference',
    ])
  })

  it('maps workplace and employment questions', () => {
    assert.equal(
      detectQuestionKeyFromText(
        'Are you looking for remote, in-person, hybrid, or no preference?',
      ),
      'remote_preference',
    )
    assert.equal(
      detectQuestionKeyFromText(
        'What type of job are you hoping to find: full-time, part-time, contract, or internship?',
      ),
      'employment_types',
    )
  })
})
