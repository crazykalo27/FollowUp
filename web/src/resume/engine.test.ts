import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDocx } from './docx.ts'
import {
  alignmentPrompts,
  assembleResume,
  confirmMarker,
  countCreatedOnUtcDay,
  creationGate,
  critiqueResume,
  formatContentDateForDisplay,
  newId,
  nowIso,
  parseJobPosting,
  parseResumeText,
  scoreItem,
  type ContentItem,
} from './engine.ts'

function item(partial: Partial<ContentItem> & Pick<ContentItem, 'type'>): ContentItem {
  const ts = nowIso()
  return {
    id: partial.id ?? newId(),
    tags: [],
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  }
}

const SAMPLE = `Kallen Selby
Engineer
kallen@example.com

Experience
Software Engineer
Acme — 2022–2024
- Built APIs
- Led migration

Education
B.S. Computer Science
State University
2020

Skills
Languages: TypeScript, Go
`

describe('resume engine', () => {
  it('parses a plain resume into library items', () => {
    const items = parseResumeText(SAMPLE)
    assert.equal(items.find((i) => i.type === 'header')?.title, 'Kallen Selby')
    assert.equal(items.find((i) => i.type === 'header')?.contactFields?.[0]?.value, 'kallen@example.com')
    const role = items.find((i) => i.type === 'experience')
    assert.equal(role?.title, 'Software Engineer')
    assert.equal(role?.organization, 'Acme')
    assert.equal(role?.bullets?.length, 2)
    assert.ok(items.some((i) => i.type === 'education'))
    const skills = items.find((i) => i.type === 'skills')
    assert.deepEqual(skills?.skillGroups?.[0]?.skills, ['TypeScript', 'Go'])
  })

  it('formats stored months for the page', () => {
    assert.equal(formatContentDateForDisplay('2024-09'), 'Sep 2024')
  })

  it('reads a labeled job posting', () => {
    const parsed = parseJobPosting('Company: Acme\nPosition: Software Engineer\nBuild APIs.')
    assert.deepEqual(parsed, { company: 'Acme', position: 'Software Engineer' })
  })

  it('keeps ignored items off the page and prefers must-have', () => {
    const keep = item({ type: 'experience', title: 'Kept role', priority: 'neutral', bullets: [{ id: 'b1', text: 'Shipped', order: 0 }] })
    const ignored = item({ type: 'experience', title: 'Hidden role Kubernetes', priority: 'ignore' })
    const must = item({ type: 'experience', title: 'Required role', priority: 'must_have', bullets: [{ id: 'b2', text: 'Owned', order: 0 }] })
    const { resume } = assembleResume({
      items: [ignored, keep, must],
      jobDescription: 'Kubernetes engineer',
      targetPages: 1,
    })
    const titles = resume.sections.flatMap((s) => s.entries.map((e) => e.contentItemId))
    assert.ok(titles.includes(must.id))
    assert.equal(titles.includes(ignored.id), false)
  })

  it('ranks high priority above an equal keyword match', () => {
    const neutral = item({ type: 'project', title: 'API platform' })
    const high = item({ type: 'project', title: 'API platform', priority: 'high' })
    const jd = 'API platform'
    assert.ok(scoreItem(high, jd) > scoreItem(neutral, jd))
  })

  it('aligns wording only from private context and does not invent metrics', () => {
    const role = item({
      type: 'experience',
      title: 'Engineer',
      experienceContext: 'Used Kubernetes in production',
      bullets: [{ id: 'b1', text: 'Built services', order: 0 }],
    })
    const { resume } = assembleResume({
      items: [role],
      jobDescription: 'Looking for Kubernetes experience',
      align: true,
      targetPages: 1,
    })
    const html = JSON.stringify(resume.sections)
    assert.match(html, /Kubernetes/)
    assert.doesNotMatch(html, /40%/)
    assert.ok((resume.alignmentHighlightBulletIds ?? []).includes('b1'))
    assert.equal(JSON.stringify(resume).includes('JD chip'), false)
  })

  it('asks before using a posting phrase the library does not support', () => {
    const role = item({ type: 'experience', title: 'Engineer', bullets: [{ id: 'b1', text: 'Built services', order: 0 }] })
    const prompts = alignmentPrompts([role], 'Kubernetes engineer')
    assert.ok(prompts.some((p) => p.marker === 'Kubernetes'))
    const confirmed = confirmMarker([role], 'Kubernetes')
    assert.match(confirmed[0]?.experienceContext ?? '', /Kubernetes/)
  })

  it('gates a second same-day resume behind a credit', () => {
    assert.deepEqual(creationGate({ plan: 'free', resumeCredits: 0, resumesCreatedTodayUtc: 0 }), { ok: true, usesCredit: false })
    assert.deepEqual(creationGate({ plan: 'free', resumeCredits: 2, resumesCreatedTodayUtc: 1 }), { ok: true, usesCredit: true })
    assert.deepEqual(creationGate({ plan: 'free', resumeCredits: 0, resumesCreatedTodayUtc: 1 }), { ok: false, usesCredit: false })
    assert.deepEqual(creationGate({ plan: 'pro', resumeCredits: 0, resumesCreatedTodayUtc: 4 }), { ok: true, usesCredit: false })
    const today = new Date().toISOString()
    assert.equal(countCreatedOnUtcDay([today, '2020-01-01T00:00:00.000Z']), 1)
  })

  it('writes a docx without viewer-only alignment chrome', () => {
    const role = item({
      type: 'experience',
      title: 'Engineer',
      bullets: [{ id: 'b1', text: 'Built services', order: 0 }],
    })
    const { resume } = assembleResume({ items: [role], name: 'Kallen resume', jobDescription: '' })
    resume.alignmentHighlightBulletIds = ['b1']
    const bytes = buildDocx(resume, [role])
    assert.equal(bytes[0], 0x50)
    assert.equal(bytes[1], 0x4b)
    const xml = new TextDecoder().decode(bytes)
    assert.match(xml, /Engineer/)
    assert.doesNotMatch(xml, /alignmentHighlight/)
  })

  it('flags a missing email in critique', () => {
    const role = item({ type: 'experience', title: 'Engineer', bullets: [{ id: 'b1', text: 'Responsible for tickets', order: 0 }] })
    const { resume } = assembleResume({ items: [role], jobDescription: '' })
    const critique = critiqueResume(resume, [role])
    assert.ok(critique.issues.some((issue) => issue.criterion === 'ATS'))
    assert.ok(critique.overallScore > 0 && critique.overallScore <= 100)
  })
})
