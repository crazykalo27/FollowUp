export const TEMPLATE_PLACEHOLDER_HELP: Array<{
  key: string
  description: string
}> = [
  { key: 'recipient', description: 'Contact’s name (or “there” if unknown)' },
  { key: 'first_name', description: 'Contact’s first name' },
  { key: 'name', description: 'Your full name (signature)' },
  { key: 'date', description: 'Today’s date' },
  { key: 'job', description: 'Contact’s title at the company' },
  { key: 'target_role', description: 'Your target job from profile (e.g. roles you want)' },
  { key: 'company', description: 'Company name' },
  { key: 'industry', description: 'Top target industry from profile' },
  { key: 'hiring_signal', description: 'Hiring signal or open role we found' },
  { key: 'employment_type', description: 'What you’re seeking (full-time, internship, etc.)' },
  { key: 'remote', description: 'Remote / hybrid / onsite preference' },
  { key: 'linkedin', description: 'Your LinkedIn URL (if set in Settings)' },
  { key: 'github', description: 'Your GitHub URL' },
  { key: 'portfolio', description: 'Your portfolio URL' },
  { key: 'website', description: 'Your website URL' },
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

export function applyTemplate(template: string, vars: TemplateVars): string {
  let out = template
  for (const [key, value] of Object.entries(vars)) {
    const safe = value || ''
    out = out.replace(new RegExp(`\\[${key}\\]`, 'gi'), safe)
  }
  return cleanupOptionalLines(out)
}

export function unresolvedPlaceholders(text: string): string[] {
  const found = new Set<string>()
  const re = /\[([a-z_]+)\]/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].toLowerCase())
  }
  return [...found]
}

export function cleanupOptionalLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      if (/^\[[a-z_]+\]$/i.test(t)) return false
      return true
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function formatEmploymentTypes(types: string[] | undefined): string {
  if (!types?.length) return 'role'
  return types.join(' / ')
}

export function formatRemotePref(pref: string | undefined): string {
  const p = (pref || '').trim().toLowerCase()
  if (!p) return 'open to location options'
  if (p === 'remote') return 'remote-friendly'
  if (p === 'hybrid') return 'hybrid'
  if (p === 'onsite') return 'onsite'
  if (p === 'flexible') return 'flexible on location'
  return pref || 'open to location options'
}

/** Remove any placeholder tags that had no data. */
export function stripRemainingPlaceholders(text: string): string {
  return text
    .replace(/\[[a-z_]+\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
