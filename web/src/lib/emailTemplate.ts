export const TEMPLATE_PLACEHOLDER_HELP: Array<{
  key: string
  description: string
}> = [
  { key: 'recipient', description: 'Contact’s name (or “there” if unknown)' },
  { key: 'first_name', description: 'Contact’s first name' },
  { key: 'name', description: 'Your full name (signature)' },
  { key: 'date', description: 'Today’s date' },
  { key: 'job', description: 'Contact’s title at the company' },
  { key: 'target_role', description: 'Your target job from profile' },
  { key: 'company', description: 'Company name' },
  { key: 'industry', description: 'Your top target industry from profile' },
  { key: 'hiring_signal', description: 'Hiring signal or open role' },
  {
    key: 'job description',
    description:
      'Exact role you applied to (from Application search) — also [job_description]',
  },
  { key: 'employment_type', description: 'Full-time, internship, part-time, etc.' },
  { key: 'remote', description: 'Remote / hybrid / onsite preference' },
  { key: 'linkedin', description: 'Your LinkedIn (Settings)' },
  { key: 'github', description: 'Your GitHub' },
  { key: 'portfolio', description: 'Your portfolio' },
  { key: 'website', description: 'Your website' },
]

export const DEFAULT_EMAIL_SUBJECT_TEMPLATE =
  '[target_role] interest — [company]'

export const DEFAULT_EMAIL_BODY_TEMPLATE = `Hi [recipient],

I'm [name]. I'm looking for [employment_type] [target_role] opportunities ([remote]) and noticed [company]'s work on [hiring_signal] in [industry]. I'd welcome a brief conversation to see if there's a fit.

Best,
[name]
[linkedin]
[github]
[portfolio]`

export type TemplateVars = Record<string, string>

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function applyTemplate(template: string, vars: TemplateVars): string {
  let out = template
  // Longer keys first so [job description] wins over [job]
  const keys = Object.keys(vars).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    const value = vars[key] || ''
    out = out.replace(new RegExp(`\\[${escapeRegExp(key)}\\]`, 'gi'), value)
  }
  return cleanupOptionalLines(out)
}

export function cleanupOptionalLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^\[[a-z_ ]+\]$/i.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function stripRemainingPlaceholders(text: string): string {
  return text
    .replace(/\[[a-z_ ]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const SAMPLE_PREVIEW_VARS: TemplateVars = {
  recipient: 'Jane Doe',
  first_name: 'Jane',
  name: 'Your Name',
  date: new Date().toLocaleDateString(),
  job: 'Engineering Manager',
  target_role: 'Quantum Software Engineer',
  company: 'Example Corp',
  industry: 'quantum computing',
  hiring_signal: 'open quantum compiler roles',
  job_description:
    'Senior Quantum Software Engineer on the compiler team — optimizing IR lowering for superconducting QPUs',
  'job description':
    'Senior Quantum Software Engineer on the compiler team — optimizing IR lowering for superconducting QPUs',
  employment_type: 'full-time',
  remote: 'remote-friendly',
  linkedin: 'https://linkedin.com/in/you',
  github: '',
  portfolio: '',
  website: '',
}
