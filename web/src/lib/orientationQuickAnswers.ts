import type { SearchProfileData } from '../types/database'

export const ORIENTATION_QUICK_OPTIONS: Record<string, string[]> = {
  locations: ['No preference'],
  employment_types: ['Full-time', 'Part-time', 'Contract', 'Internship'],
  remote_preference: ['Remote', 'In-person', 'Hybrid', 'No preference'],
  company_size: ['Large', 'Medium', 'Small', 'No preference'],
  seniority: ['Entry', 'Mid-level', 'Experienced'],
  industries: ['Confirm'],
  roles: ['Confirm'],
}

export const QUICK_ANSWER_HINT = 'Type or press the buttons below to respond.'

export const ORIENTATION_QUESTION_KEYS = [
  'locations',
  'employment_types',
  'remote_preference',
  'company_size',
  'seniority',
  'industries',
  'roles',
] as const

export type OrientationQuestionKey = (typeof ORIENTATION_QUESTION_KEYS)[number]

/** Match the latest assistant turn to one closed-ended question (first hit wins). */
const QUESTION_TEXT_MATCHERS: Array<{
  key: OrientationQuestionKey
  test: (t: string) => boolean
}> = [
  {
    key: 'locations',
    test: (t) =>
      t.includes('location priorit') ||
      (t.includes('cities') && t.includes('no preference')),
  },
  {
    key: 'employment_types',
    test: (t) =>
      t.includes('full-time') &&
      (t.includes('internship') || t.includes('part-time')),
  },
  {
    key: 'remote_preference',
    test: (t) =>
      t.includes('remote') && (t.includes('hybrid') || t.includes('in-person')),
  },
  {
    key: 'seniority',
    test: (t) =>
      t.includes('entry') &&
      t.includes('mid-level') &&
      (t.includes('experienced') || t.includes('position')),
  },
  {
    key: 'company_size',
    test: (t) =>
      t.includes('company size') ||
      (t.includes('large') && t.includes('medium') && t.includes('small')),
  },
  {
    key: 'industries',
    test: (t) => t.includes('industr') && t.includes('nich'),
  },
  {
    key: 'roles',
    test: (t) =>
      t.includes('job title') ||
      t.includes('titles should we use') ||
      t.includes('titles i suggest'),
  },
]

export function detectQuestionKeyFromText(
  text: string | undefined,
): OrientationQuestionKey | null {
  if (!text) return null
  const t = text.toLowerCase()
  for (const { key, test } of QUESTION_TEXT_MATCHERS) {
    if (test(t)) return key
  }
  return null
}

export function detectOrientationQuestionKey(
  profile: SearchProfileData | null,
  lastAssistantText: string | undefined,
): OrientationQuestionKey | null {
  // Prefer the latest AI question text so chips can't lag one step behind
  // (e.g. company-size buttons on the experience question).
  const fromText = detectQuestionKeyFromText(lastAssistantText)
  if (fromText) return fromText

  if (!profile) return null
  const q = Number(profile.orientation_q ?? 0)
  if (!Number.isFinite(q) || q < 0 || q >= ORIENTATION_QUESTION_KEYS.length) {
    return null
  }
  return ORIENTATION_QUESTION_KEYS[q]
}

export function orientationQuickOptions(
  profile: SearchProfileData | null,
  seriesComplete: boolean,
  lastAssistantText: string | undefined,
): string[] | null {
  if (seriesComplete) return null
  const key = detectOrientationQuestionKey(profile, lastAssistantText)
  if (!key) return null
  const options = ORIENTATION_QUICK_OPTIONS[key]
  return options?.length ? options : null
}
