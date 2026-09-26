/** Master-resume data model and on-device build/parse/critique. */

export type ContentType =
  | 'header'
  | 'experience'
  | 'education'
  | 'project'
  | 'skills'
  | 'certification'
  | 'award'
  | 'volunteer'
  | 'leadership'
  | 'extracurricular'
  | 'custom'

export type ItemPriority = 'must_have' | 'high' | 'neutral' | 'low' | 'ignore'
export type BulletStyle = 'disc' | 'circle' | 'square' | 'dash' | 'none'
export type ApplicationStatus = 'applied' | 'interview' | 'denied' | 'admitted'
export type ContactKind = 'email' | 'phone' | 'website' | 'linkedin' | 'github' | 'address' | 'custom'

export interface BulletPoint {
  id: string
  text: string
  order: number
}

export interface ContactField {
  id: string
  type: ContactKind
  label: string
  value: string
  order: number
}

export interface SkillGroup {
  id: string
  category: string
  skills: string[]
  order: number
}

export interface CustomField {
  id: string
  label: string
  value: string
  order: number
}

export interface LinkField {
  id: string
  label: string
  url: string
  order: number
}

export interface ContentItem {
  id: string
  type: ContentType
  title?: string
  subtitle?: string
  organization?: string
  location?: string
  startDate?: string
  endDate?: string
  isCurrent?: boolean
  description?: string
  bullets?: BulletPoint[]
  contactFields?: ContactField[]
  skillGroups?: SkillGroup[]
  customFields?: CustomField[]
  links?: LinkField[]
  tags: string[]
  notes?: string
  /** Private tailoring notes. Never printed on the resume. */
  experienceContext?: string
  priority?: ItemPriority
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
  color?: string
}

export interface ResumeEntryFormatting {
  richText?: Record<string, string>
}

export interface ResumeEntry {
  id: string
  contentItemId: string
  order: number
  selectedBulletIds?: string[]
  overrides?: Partial<ContentItem>
  formatting?: ResumeEntryFormatting
  addedBullets?: BulletPoint[]
}

export interface ResumeSection {
  id: string
  title: string
  type: string
  order: number
  entries: ResumeEntry[]
  bulletStyle?: BulletStyle
}

export interface ResumeTheme {
  fontFamily?: string
  fontSizePt?: number
  textColor?: string
  accentColor?: string
  lineHeight?: number
  sectionSpacingPt?: number
  entrySpacingPt?: number
}

export interface AiBuildStats {
  builtAtIso: string
  targetPages: number
  finalPageCount: number
  finalLastPageFillPercent: number
  sectionCount: number
  sectionTitles: string[]
  entriesTotal: number
  bulletsVisible: number
  entriesByType: Record<string, number>
  avgFinalScoreVisible: number | null
  avgRelevanceVisible: number | null
  avgImpactVisible: number | null
  avgComplexityVisible: number | null
  avgCredibilityVisible: number | null
  blueprintSectionOrder: string[]
  fillTraceAddBullets: number
  fillTraceRemoveBullets: number
  fillTraceAddEntries: number
  warningsCount: number
  languageAlignmentEnabled: boolean
  languageAlignmentApplied: boolean
  bulletsRewrittenCount: number
  alignmentRejectedCount: number
  skillsNormalizedCount: number
  alignmentBulletIds: string[]
  keywordCoveragePct: number
  keywordCoverageMissingCount: number
}

export interface Resume {
  id: string
  name: string
  templateId: string
  sections: ResumeSection[]
  theme?: ResumeTheme
  jobDescription?: string
  targetPages?: number
  alignmentHighlightBulletIds?: string[]
  lastAiBuildStats?: AiBuildStats
  createdAt: string
  updatedAt: string
}

export interface JobApplication {
  id: string
  resumeId?: string
  resumeName?: string
  company: string
  position: string
  link?: string
  appliedDate: string
  lastFollowedUp?: string
  notes?: string
  status: ApplicationStatus
  createdAt: string
  updatedAt: string
}

export interface CritiqueIssue {
  rank: number
  severity: 'high' | 'medium' | 'low'
  criterion: string
  section: string
  issue: string
  fix: string
}

export interface Critique {
  overallScore: number
  scores: Record<string, { score: number; summary: string }>
  issues: CritiqueIssue[]
  keywordAnalysis: { matched: string[]; gaps: string[]; stuffed: string[] } | null
  bulletStats: { total: number; withMetrics: number; dutyOnly: number; metricNeeded: number }
  topStrengths: string[]
}

export const CONTENT_TYPES: ContentType[] = [
  'header',
  'experience',
  'education',
  'project',
  'skills',
  'certification',
  'award',
  'volunteer',
  'leadership',
  'extracurricular',
  'custom',
]

const TYPE_LABEL: Record<ContentType, string> = {
  header: 'Header / contact',
  experience: 'Experience',
  education: 'Education',
  project: 'Project',
  skills: 'Skills',
  certification: 'Certification',
  award: 'Award',
  volunteer: 'Volunteer',
  leadership: 'Leadership',
  extracurricular: 'Extracurricular',
  custom: 'Custom',
}

export function contentTypeLabel(type: ContentType): string {
  return TYPE_LABEL[type]
}

export const PRIORITY_OPTIONS: { value: ItemPriority; label: string; hint: string }[] = [
  { value: 'must_have', label: 'Must have', hint: 'Always included, up to the section cap.' },
  { value: 'high', label: 'High', hint: 'Ranked above similar neutral items.' },
  { value: 'neutral', label: 'Neutral', hint: 'Ranked on fit with the posting.' },
  { value: 'low', label: 'Low', hint: 'Ranked below similar neutral items.' },
  { value: 'ignore', label: 'Ignore', hint: 'Left out of tailored resumes.' },
]

export const TEMPLATES: { id: string; name: string; description: string }[] = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Serif headings and a quiet traditional page.',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Sans-serif page with a stronger accent.',
  },
]

export const THEME_PRESETS: { id: string; name: string; theme: ResumeTheme }[] = [
  {
    id: 'classic',
    name: 'Classic',
    theme: { fontFamily: 'Georgia, "Times New Roman", serif', fontSizePt: 11, textColor: '#1c1916', accentColor: '#1c1916', lineHeight: 1.35, sectionSpacingPt: 12, entrySpacingPt: 8 },
  },
  {
    id: 'modern',
    name: 'Modern',
    theme: { fontFamily: 'Calibri, "Segoe UI", sans-serif', fontSizePt: 10.5, textColor: '#1a1a1a', accentColor: '#1d4e89', lineHeight: 1.4, sectionSpacingPt: 10, entrySpacingPt: 6 },
  },
  {
    id: 'elegant',
    name: 'Elegant',
    theme: { fontFamily: 'Palatino, Georgia, serif', fontSizePt: 10.5, textColor: '#241c16', accentColor: '#6b3f2a', lineHeight: 1.4, sectionSpacingPt: 14, entrySpacingPt: 8 },
  },
  {
    id: 'compact',
    name: 'Compact',
    theme: { fontFamily: 'Calibri, "Segoe UI", sans-serif', fontSizePt: 9.5, textColor: '#222', accentColor: '#333', lineHeight: 1.15, sectionSpacingPt: 6, entrySpacingPt: 3 },
  },
]

const PRIORITY_BOOST: Record<ItemPriority, number> = {
  must_have: 1_000_000,
  high: 20,
  neutral: 0,
  low: -20,
  ignore: 0,
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function templateTheme(templateId: string): ResumeTheme {
  if (templateId === 'modern') return { ...THEME_PRESETS[1].theme }
  return { ...THEME_PRESETS[0].theme }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function richPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function bulletGlyph(style?: BulletStyle): string {
  switch (style) {
    case 'circle':
      return '◦'
    case 'square':
      return '▪'
    case 'dash':
      return '–'
    case 'none':
      return ''
    default:
      return '•'
  }
}

function clampMonth(mm: number): string {
  return String(Math.min(12, Math.max(1, mm))).padStart(2, '0')
}

const MONTH_NAME: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
  apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09', oct: '10', october: '10',
  nov: '11', november: '11', dec: '12', december: '12',
}

export function normalizeContentDateForStorage(raw: unknown, kind: 'start' | 'end' = 'start'): string | undefined {
  if (raw == null) return undefined
  const s0 = String(raw).trim()
  if (!s0) return undefined
  const lower = s0.toLowerCase()
  if (['present', 'current', 'now', 'ongoing', 'n/a', 'tbd'].includes(lower)) return undefined
  const defaultMonth = kind === 'end' ? '12' : '01'
  const iso = s0.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/)
  if (iso) return `${iso[1]}-${clampMonth(parseInt(iso[2], 10))}`
  if (/^\d{4}$/.test(s0)) return `${s0}-${defaultMonth}`
  const slash = s0.match(/^(\d{1,2})\s*\/\s*(\d{4})$/)
  if (slash) return `${slash[2]}-${clampMonth(parseInt(slash[1], 10))}`
  const monYear = s0.match(/^([A-Za-z]+)\.?\s+(\d{4})$/)
  if (monYear) {
    const key = monYear[1].toLowerCase()
    const mm = MONTH_NAME[key] ?? MONTH_NAME[key.slice(0, 3)]
    if (mm) return `${monYear[2]}-${mm}`
  }
  return undefined
}

export function formatContentDateForDisplay(d?: string, kind: 'start' | 'end' = 'start'): string {
  if (!d?.trim()) return ''
  const via = normalizeContentDateForStorage(d, kind)
  if (via) {
    const [y, m] = via.split('-')
    const mi = parseInt(m, 10) - 1
    if (mi >= 0 && mi < 12) return `${MONTHS[mi]} ${y}`
  }
  if (/^\d{4}$/.test(d.trim())) return d.trim()
  return d.trim()
}

export function dateRangeLabel(item: Pick<ContentItem, 'startDate' | 'endDate' | 'isCurrent'>): string {
  const start = formatContentDateForDisplay(item.startDate, 'start')
  if (item.isCurrent) return start ? `${start} – Present` : 'Present'
  const end = formatContentDateForDisplay(item.endDate, 'end')
  if (start && end) return `${start} – ${end}`
  return start || end
}

export function countCreatedOnUtcDay(isoDates: string[], now = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const end = start + 86_400_000
  return isoDates.filter((iso) => {
    const t = Date.parse(iso)
    return t >= start && t < end
  }).length
}

/** Free plan: one new resume per UTC day, then a credit. Pro is unlimited. */
export function creationGate(input: {
  plan: 'free' | 'pro'
  resumeCredits: number
  resumesCreatedTodayUtc: number
}): { ok: boolean; usesCredit: boolean } {
  if (input.plan === 'pro') return { ok: true, usesCredit: false }
  if (input.resumesCreatedTodayUtc < 1) return { ok: true, usesCredit: false }
  if (input.resumeCredits > 0) return { ok: true, usesCredit: true }
  return { ok: false, usesCredit: false }
}

function blankItem(type: ContentType, partial: Partial<ContentItem> = {}): ContentItem {
  const ts = nowIso()
  return {
    id: newId(),
    type,
    tags: [],
    createdAt: ts,
    updatedAt: ts,
    ...partial,
    bullets: partial.bullets,
    contactFields: partial.contactFields,
    skillGroups: partial.skillGroups,
    links: partial.links,
    customFields: partial.customFields,
  }
}

const SECTION_HEADS: { type: ContentType; re: RegExp }[] = [
  { type: 'experience', re: /^(work\s+)?(professional\s+)?experience|employment|work\s+history$/i },
  { type: 'education', re: /^education$/i },
  { type: 'project', re: /^projects?$/i },
  { type: 'skills', re: /^(technical\s+)?skills$/i },
  { type: 'certification', re: /^certifications?|licenses?$/i },
  { type: 'award', re: /^awards?(?:\s+and\s+honors)?$/i },
  { type: 'volunteer', re: /^volunteer(?:ing)?(?:\s+experience)?$/i },
  { type: 'leadership', re: /^leadership$/i },
  { type: 'extracurricular', re: /^extracurriculars?$/i },
]

function headingType(line: string): ContentType | null {
  const t = line.replace(/[:\s]+$/g, '').trim()
  if (t.length > 40) return null
  for (const head of SECTION_HEADS) {
    if (head.re.test(t)) return head.type
  }
  return null
}

function isBullet(line: string): boolean {
  return /^[-•*▪◦–]\s+/.test(line)
}

function bulletText(line: string): string {
  return line.replace(/^[-•*▪◦–]\s+/, '').trim()
}

function contactKind(value: string): ContactKind {
  if (value.includes('@')) return 'email'
  if (/linkedin/i.test(value)) return 'linkedin'
  if (/github/i.test(value)) return 'github'
  if (/https?:|www\./i.test(value)) return 'website'
  if (/\d{3}/.test(value)) return 'phone'
  return 'custom'
}

function pushContact(fields: ContactField[], value: string) {
  const v = value.trim()
  if (!v || fields.some((f) => f.value.toLowerCase() === v.toLowerCase())) return
  const type = contactKind(v)
  fields.push({
    id: newId(),
    type,
    label: type === 'email' ? 'Email' : type === 'phone' ? 'Phone' : type[0].toUpperCase() + type.slice(1),
    value: v,
    order: fields.length,
  })
}

function parseHeader(lines: string[]): ContentItem | null {
  const useful = lines.map((l) => l.trim()).filter(Boolean)
  if (useful.length === 0) return null
  const contacts: ContactField[] = []
  const rest: string[] = []
  for (const line of useful) {
    const emails = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
    const phones = line.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}/g) ?? []
    const urls = line.match(/https?:\/\/\S+|www\.\S+|linkedin\.com\/\S+|github\.com\/\S+/gi) ?? []
    if (emails.length + phones.length + urls.length > 0) {
      for (const hit of [...emails, ...phones, ...urls]) pushContact(contacts, hit.replace(/[),.;]+$/, ''))
      const leftover = line
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
        .replace(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]\d{4}/g, '')
        .replace(/https?:\/\/\S+|www\.\S+/gi, '')
        .replace(/[|•·,]+/g, ' ')
        .trim()
      if (leftover.length > 2 && !/^[\d\s()+.-]+$/.test(leftover)) rest.push(leftover)
    } else {
      rest.push(line)
    }
  }
  return blankItem('header', {
    title: rest[0],
    subtitle: rest[1],
    location: rest.slice(2).join(', ') || undefined,
    contactFields: contacts,
  })
}

function bulletsFrom(lines: string[]): BulletPoint[] {
  return lines.filter(isBullet).map((line, order) => ({
    id: newId(),
    text: bulletText(line),
    order,
  }))
}

function parseRole(type: ContentType, block: string[]): ContentItem | null {
  const lines = block.map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const prose = lines.filter((l) => !isBullet(l))
  const title = prose[0]?.replace(/\s+[|–—-]\s+.*$/, '').trim()
  let organization = ''
  let location = ''
  let startDate: string | undefined
  let endDate: string | undefined
  let isCurrent = false
  for (const line of prose.slice(1)) {
    const range = line.match(/(19|20)\d{2}\s*[-–—to]+\s*((?:19|20)\d{2}|present|current|now)/i)
    const year = line.match(/\b((?:19|20)\d{2})\b/)
    if (range) {
      startDate = normalizeContentDateForStorage(range[0].slice(0, 4), 'start')
      const endRaw = range[2]
      if (/present|current|now/i.test(endRaw)) isCurrent = true
      else endDate = normalizeContentDateForStorage(endRaw, 'end')
      const orgPart = line.replace(range[0], '').replace(/^[\s,|–—-]+|[\s,|–—-]+$/g, '').trim()
      if (orgPart && !organization) organization = orgPart
    } else if (year && !startDate && prose.indexOf(line) > 0 && line.length < 24) {
      startDate = normalizeContentDateForStorage(year[1], 'start')
    } else if (!organization) {
      organization = line
    } else if (!location && line.length < 40) {
      location = line
    }
  }
  const datedTitle = prose[0]?.match(/(19|20)\d{2}/)
  if (!startDate && datedTitle) startDate = normalizeContentDateForStorage(datedTitle[0], 'start')
  return blankItem(type, {
    title: title || 'Untitled',
    organization: organization || undefined,
    location: location || undefined,
    startDate,
    endDate,
    isCurrent,
    bullets: bulletsFrom(lines),
    description: prose.slice(organization ? 2 : 1).filter((l) => !/(19|20)\d{2}/.test(l)).join(' ') || undefined,
  })
}

function parseSkills(lines: string[]): ContentItem {
  const groups: SkillGroup[] = []
  const loose: string[] = []
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    const raw = isBullet(line) ? bulletText(line) : line
    const labeled = raw.match(/^([^:]{2,40}):\s*(.+)$/)
    if (labeled) {
      groups.push({
        id: newId(),
        category: labeled[1].trim(),
        skills: labeled[2].split(/[,|•]/).map((s) => s.trim()).filter(Boolean),
        order: groups.length,
      })
    } else {
      for (const part of raw.split(/[,|•]/).map((s) => s.trim()).filter(Boolean)) loose.push(part)
    }
  }
  if (loose.length) {
    groups.push({ id: newId(), category: 'Skills', skills: loose, order: groups.length })
  }
  return blankItem('skills', { title: 'Skills', skillGroups: groups })
}

function parseSection(type: ContentType, body: string[]): ContentItem[] {
  if (type === 'skills') {
    const item = parseSkills(body)
    return item.skillGroups && item.skillGroups.length > 0 ? [item] : []
  }
  const blocks: string[][] = []
  let current: string[] = []
  for (const line of body) {
    if (!line.trim()) {
      if (current.length) blocks.push(current)
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current)
  const items = blocks
    .map((block) => parseRole(type, block))
    .filter((item): item is ContentItem => Boolean(item && (item.title || item.bullets?.length)))
  if (items.length === 0 && body.some((l) => l.trim())) {
    const role = parseRole(type, body)
    return role ? [role] : []
  }
  return items
}

/** Turn pasted or uploaded resume text into library items. */
export function parseResumeText(raw: string): ContentItem[] {
  const lines = raw.replace(/\r/g, '').split('\n')
  const heads: { index: number; type: ContentType }[] = []
  lines.forEach((line, index) => {
    const type = headingType(line.trim())
    if (type) heads.push({ index, type })
  })
  const items: ContentItem[] = []
  const preamble = lines.slice(0, heads[0]?.index ?? lines.length)
  const header = parseHeader(preamble)
  if (header) items.push(header)
  heads.forEach((head, i) => {
    const end = heads[i + 1]?.index ?? lines.length
    items.push(...parseSection(head.type, lines.slice(head.index + 1, end)))
  })
  if (items.length === 0) {
    const fallback = parseHeader(lines)
    if (fallback?.title) items.push(fallback)
  }
  return items
}

export function textFromUpload(fileName: string, raw: string): string {
  const name = fileName.toLowerCase()
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.text')) return raw
  const matches = raw.match(/[ -~\n\r\t]{4,}/g) ?? []
  return matches.join('\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function cleanLine(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^["'[\s]+|["'\]\s]+$/g, '').trim()
}

function jobTitleLike(s: string): boolean {
  return /\b(engineer|developer|scientist|analyst|architect|designer|manager|director|consultant|intern(?:ship)?|researcher|lead|principal|staff)\b/i.test(s.slice(0, 200))
}

/** Conservative company + role extraction. Returns null when it is not confident. */
export function parseJobPosting(text: string): { company: string; position: string } | null {
  const head = text.slice(0, 8000)
  const companyLabeled = head.match(/^\s*(?:employer|company|organization)\s*[:\u2013-]\s*(.+)$/im)?.[1]
  const positionLabeled = head.match(/^\s*(?:job\s*title|position|role)\s*[:\u2013-]\s*(.+)$/im)?.[1]
  if (companyLabeled && positionLabeled) {
    const company = cleanLine(companyLabeled)
    const position = cleanLine(positionLabeled)
    if (company.length >= 2 && position.length >= 4 && jobTitleLike(position)) {
      return { company, position }
    }
  }
  const first = cleanLine(head.split(/\r?\n/).find((l) => l.trim()) ?? '')
  const at = first.toLowerCase().lastIndexOf(' at ')
  if (at >= 8) {
    const position = cleanLine(first.slice(0, at))
    const company = cleanLine(first.slice(at + 4).replace(/\s*\|.*$/, ''))
    if (jobTitleLike(position) && company.length >= 2 && company.length <= 160) {
      return { company, position }
    }
  }
  return null
}

const MARKER_STOP = new Set([
  'the', 'and', 'with', 'for', 'you', 'our', 'this', 'that', 'your', 'will', 'from', 'into',
  'about', 'role', 'team', 'work', 'have', 'are', 'job', 'who', 'what', 'when', 'where',
])

/** Salient posting phrases (tools, titles, quoted terms). Capped like the original scorer. */
export function languageMarkers(jobDescription: string): string[] {
  const found: string[] = []
  const push = (raw: string) => {
    const t = raw.replace(/\s+/g, ' ').trim()
    if (t.length < 2 || t.length > 48) return
    if (!/[A-Za-z]/.test(t)) return
    if (MARKER_STOP.has(t.toLowerCase())) return
    if (found.some((f) => f.toLowerCase() === t.toLowerCase())) return
    found.push(t)
  }
  for (const match of jobDescription.matchAll(/[“"]([^”"]{2,48})[”"]/g)) push(match[1] ?? '')
  for (const match of jobDescription.matchAll(/\b([A-Za-z][\w+#.]*[A-Z0-9][\w+#.]*)\b/g)) push(match[1] ?? '')
  for (const match of jobDescription.matchAll(/\b([A-Z][a-z]{3,}(?:\s+[A-Z][a-z]+){0,2})\b/g)) push(match[1] ?? '')
  for (const match of jobDescription.matchAll(/\b([A-Z]{2,6})\b/g)) push(match[1] ?? '')
  return found.slice(0, 22)
}

function itemBlob(item: ContentItem): string {
  return [
    item.title,
    item.subtitle,
    item.organization,
    item.location,
    item.description,
    item.notes,
    item.experienceContext,
    ...(item.bullets?.map((b) => b.text) ?? []),
    ...(item.skillGroups?.flatMap((g) => [g.category, ...g.skills]) ?? []),
    ...(item.tags ?? []),
  ]
    .filter(Boolean)
    .join('\n')
}

export function itemSearchText(item: ContentItem): string {
  return itemBlob(item).toLowerCase()
}

function containsTerm(haystack: string, term: string): boolean {
  return haystack.toLowerCase().includes(term.toLowerCase())
}

export function alignmentPrompts(items: ContentItem[], jobDescription: string): { marker: string; question: string }[] {
  const markers = languageMarkers(jobDescription)
  const blob = items.map(itemBlob).join('\n')
  return markers
    .filter((marker) => !containsTerm(blob, marker))
    .slice(0, 3)
    .map((marker) => ({
      marker,
      question: `The posting says “${marker}”, and that phrase is not in your library. Did you actually do this?`,
    }))
}

/** Record an honest yes by attaching the phrase to the closest library item. */
export function confirmMarker(items: ContentItem[], marker: string): ContentItem[] {
  const pool = items.filter((item) => item.type !== 'header' && item.priority !== 'ignore')
  const target = pool[0]
  if (!target) return items
  return items.map((item) => {
    if (item.id !== target.id) return item
    const prev = item.experienceContext?.trim() ?? ''
    if (containsTerm(prev, marker)) return item
    const next = prev ? `${prev}\nConfirmed: ${marker}.` : `Confirmed: ${marker}.`
    return { ...item, experienceContext: next, updatedAt: nowIso() }
  })
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? []).filter((t) => !MARKER_STOP.has(t))
}

function overlapScore(text: string, jdTokens: Set<string>): number {
  if (jdTokens.size === 0) return 0
  let hit = 0
  const seen = new Set<string>()
  for (const token of tokens(text)) {
    if (jdTokens.has(token) && !seen.has(token)) {
      seen.add(token)
      hit += 1
    }
  }
  return hit * 10
}

export function scoreItem(item: ContentItem, jobDescription: string): number {
  const jdTokens = new Set(tokens(jobDescription))
  const base = overlapScore(itemBlob(item), jdTokens)
  return base + PRIORITY_BOOST[item.priority ?? 'neutral']
}

const SECTION_TITLE: Record<string, string> = {
  header: 'Header',
  summary: 'Summary',
  work_experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  certifications: 'Certifications',
  awards: 'Awards',
  volunteer_experience: 'Volunteer',
  leadership: 'Leadership',
  custom: 'Highlights',
}

const CONTENT_TO_SECTION: Record<ContentType, string> = {
  header: 'header',
  experience: 'work_experience',
  education: 'education',
  project: 'projects',
  skills: 'skills',
  certification: 'certifications',
  award: 'awards',
  volunteer: 'volunteer_experience',
  leadership: 'leadership',
  extracurricular: 'leadership',
  custom: 'custom',
}

function limitsFor(section: string, pages: number): { maxEntries: number; bullets: number } {
  const p = Math.max(1, pages)
  switch (section) {
    case 'header':
      return { maxEntries: 1, bullets: 0 }
    case 'work_experience':
      return { maxEntries: Math.min(8, 2 + (p - 1) * 2), bullets: p <= 1 ? 4 : 5 + (p - 1) }
    case 'projects':
      return { maxEntries: Math.min(8, 2 + (p - 1) * 2), bullets: p <= 1 ? 3 : 4 }
    case 'skills':
      return { maxEntries: Math.min(6, 3 + (p - 1)), bullets: 0 }
    case 'education':
      return { maxEntries: Math.min(4, 1 + (p - 1)), bullets: 2 }
    default:
      return { maxEntries: Math.min(4, 1 + (p - 1)), bullets: 3 }
  }
}

function hasNewMetric(original: string, next: string): boolean {
  const nums = (s: string) => s.match(/\d[\d,]*(?:\.\d+)?%?/g) ?? []
  const before = new Set(nums(original))
  return nums(next).some((n) => !before.has(n))
}

function lengthOk(original: string, next: string): boolean {
  const cap = original.length < 92 ? Math.max(original.length * 1.38, original.length + 28) : original.length * 1.38
  return next.length <= cap + 0.01
}

function alignBullet(text: string, supported: string[], context: string): { text: string; changed: boolean; rejected: boolean } {
  let next = text
  let changed = false
  let rejected = false
  for (const marker of supported) {
    if (containsTerm(next, marker)) {
      const exact = next.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
      if (exact && exact[0] !== marker) {
        const replaced = next.replace(exact[0], marker)
        if (!hasNewMetric(text, replaced)) {
          next = replaced
          changed = true
        }
      }
      continue
    }
    if (!containsTerm(context, marker)) continue
    const candidate = `${next} (${marker})`
    if (hasNewMetric(text, candidate) || !lengthOk(text, candidate)) {
      rejected = true
      continue
    }
    next = candidate
    changed = true
  }
  return { text: next, changed, rejected }
}

function visibleBulletList(entry: ResumeEntry, item: ContentItem): BulletPoint[] {
  const all = [...(item.bullets ?? []), ...(entry.addedBullets ?? [])].sort((a, b) => a.order - b.order)
  if (!entry.selectedBulletIds) return all
  const keep = new Set(entry.selectedBulletIds)
  return all.filter((b) => keep.has(b.id))
}

export function visibleBullets(entry: ResumeEntry, item: ContentItem): BulletPoint[] {
  return visibleBulletList(entry, item)
}

export function resolveEntry(entry: ResumeEntry, item: ContentItem): ContentItem {
  const merged: ContentItem = { ...item, ...entry.overrides, id: item.id, type: item.type, tags: item.tags }
  const rich = entry.formatting?.richText ?? {}
  for (const [key, html] of Object.entries(rich)) {
    if (key.startsWith('bullet:')) continue
    const plain = richPlain(html)
    if (key === 'title') merged.title = plain
    if (key === 'subtitle') merged.subtitle = plain
    if (key === 'organization') merged.organization = plain
    if (key === 'location') merged.location = plain
    if (key === 'description') merged.description = plain
  }
  return merged
}

function estimateLines(resume: Resume, items: Map<string, ContentItem>): number {
  let lines = 0
  for (const section of resume.sections) {
    if (section.type === 'header') {
      lines += 5
      continue
    }
    lines += 2
    for (const entry of section.entries) {
      const item = items.get(entry.contentItemId)
      lines += 2
      if (item) lines += visibleBulletList(entry, item).length
      else lines += 1
    }
  }
  return Math.max(1, lines)
}

export function assembleResume(input: {
  items: ContentItem[]
  jobDescription?: string
  templateId?: string
  targetPages?: number
  name?: string
  align?: boolean
  declinedMarkers?: string[]
  id?: string
}): { resume: Resume; warnings: string[] } {
  const jd = input.jobDescription?.trim() ?? ''
  const pages = Math.min(4, Math.max(1, input.targetPages ?? 1))
  const align = Boolean(input.align && jd)
  const declined = new Set((input.declinedMarkers ?? []).map((m) => m.toLowerCase()))
  const warnings: string[] = []
  if (!jd) warnings.push('No job description — ranking uses your priorities only.')
  const eligible = input.items.filter((item) => item.priority !== 'ignore')
  if (eligible.length === 0) warnings.push('Library has nothing that can go on a resume yet.')

  const ranked = [...eligible].sort((a, b) => scoreItem(b, jd) - scoreItem(a, jd))
  const bySection = new Map<string, ContentItem[]>()
  for (const item of ranked) {
    const key = CONTENT_TO_SECTION[item.type]
    const list = bySection.get(key) ?? []
    list.push(item)
    bySection.set(key, list)
  }

  const order = [
    'header',
    'work_experience',
    'education',
    'skills',
    'projects',
    'leadership',
    'certifications',
    'awards',
    'volunteer_experience',
    'custom',
  ]
  const jdTokens = new Set(tokens(jd))
  const markers = languageMarkers(jd).filter((m) => !declined.has(m.toLowerCase()))
  let rewritten = 0
  let rejected = 0
  let skillsNormalized = 0
  const highlight: string[] = []
  let addBullets = 0
  let removeBullets = 0
  let addEntries = 0

  const sections: ResumeSection[] = []
  const scoreById = new Map(ranked.map((item) => [item.id, scoreItem(item, jd)]))

  for (const sectionType of order) {
    const pool = bySection.get(sectionType) ?? []
    if (pool.length === 0) continue
    const limits = limitsFor(sectionType, pages)
    const must = pool.filter((item) => item.priority === 'must_have')
    const rest = pool.filter((item) => item.priority !== 'must_have')
    const chosen = [...must, ...rest].slice(0, Math.max(limits.maxEntries, Math.min(must.length, limits.maxEntries)))
    if (chosen.length === 0) continue
    const entries: ResumeEntry[] = chosen.map((item, index) => {
      const sourceBullets = [...(item.bullets ?? [])]
      const scored = sourceBullets
        .map((bullet, bulletIndex) => ({ bullet, bulletIndex, score: overlapScore(bullet.text, jdTokens) }))
        .sort((a, b) => b.score - a.score || a.bulletIndex - b.bulletIndex)
      let picked = jd
        ? scored.slice(0, limits.bullets).sort((a, b) => a.bulletIndex - b.bulletIndex).map((row) => row.bullet)
        : sourceBullets.slice(0, limits.bullets || sourceBullets.length)
      if (limits.bullets === 0) picked = []
      const added: BulletPoint[] = []
      const selectedIds: string[] = []
      const rich: Record<string, string> = {}
      const context = item.experienceContext ?? ''
      for (const bullet of picked) {
        let text = bullet.text
        if (align) {
          const result = alignBullet(text, markers, `${context}\n${itemBlob(item)}`)
          if (result.rejected) rejected += 1
          if (result.changed) {
            text = result.text
            rewritten += 1
            highlight.push(bullet.id)
            rich[`bullet:${bullet.id}`] = escapeHtml(text)
          }
        }
        selectedIds.push(bullet.id)
        if (text !== bullet.text && !rich[`bullet:${bullet.id}`]) {
          rich[`bullet:${bullet.id}`] = escapeHtml(text)
        }
      }
      let skillOverride: ContentItem['skillGroups']
      if (sectionType === 'skills' && align && item.skillGroups) {
        skillOverride = item.skillGroups.map((group) => ({
          ...group,
          skills: group.skills.map((skill) => {
            const marker = markers.find((m) => m.toLowerCase() === skill.toLowerCase() && m !== skill)
            if (!marker) return skill
            skillsNormalized += 1
            return marker
          }),
        }))
      }
      const entry: ResumeEntry = {
        id: newId(),
        contentItemId: item.id,
        order: index,
        selectedBulletIds: picked.length ? selectedIds : undefined,
        addedBullets: added.length ? added : undefined,
        overrides: skillOverride ? { skillGroups: skillOverride } : undefined,
        formatting: Object.keys(rich).length ? { richText: rich } : undefined,
      }
      return entry
    })
    sections.push({
      id: newId(),
      title: SECTION_TITLE[sectionType] ?? 'Section',
      type: sectionType,
      order: sections.length,
      entries,
      bulletStyle: 'disc',
    })
    addEntries += entries.length
  }

  const ts = nowIso()
  let resume: Resume = {
    id: input.id ?? newId(),
    name: input.name?.trim() || 'Tailored resume',
    templateId: input.templateId || 'professional',
    sections,
    theme: templateTheme(input.templateId || 'professional'),
    jobDescription: jd || undefined,
    targetPages: pages,
    alignmentHighlightBulletIds: highlight,
    createdAt: ts,
    updatedAt: ts,
  }

  const itemMap = new Map(input.items.map((item) => [item.id, item]))
  const lineBudget = pages * 46
  let lines = estimateLines(resume, itemMap)
  const fillAdd = () => {
    if (lines >= lineBudget * 0.72) return false
    for (const section of resume.sections) {
      for (const entry of section.entries) {
        const item = itemMap.get(entry.contentItemId)
        if (!item?.bullets) continue
        const selected = new Set(entry.selectedBulletIds ?? [])
        const extra = item.bullets.find((b) => !selected.has(b.id))
        if (!extra) continue
        entry.selectedBulletIds = [...(entry.selectedBulletIds ?? []), extra.id]
        lines += 1
        addBullets += 1
        return true
      }
    }
    return false
  }
  const fillRemove = () => {
    if (lines <= lineBudget + 2) return false
    for (const section of [...resume.sections].reverse()) {
      if (section.type === 'header') continue
      for (const entry of [...section.entries].reverse()) {
        const ids = entry.selectedBulletIds
        if (!ids || ids.length <= 1) continue
        entry.selectedBulletIds = ids.slice(0, -1)
        lines -= 1
        removeBullets += 1
        return true
      }
    }
    return false
  }
  let guard = 0
  while (fillAdd() && guard < 40) guard += 1
  while (fillRemove() && guard < 80) guard += 1

  const pageCount = Math.max(1, Math.ceil(lines / 46))
  const lastFill = lines % 46 === 0 ? 100 : Math.round(((lines % 46) / 46) * 100)
  const visibleScores: number[] = []
  let bulletsVisible = 0
  const entriesByType: Record<string, number> = {}
  let impactHits = 0
  for (const section of resume.sections) {
    for (const entry of section.entries) {
      entriesByType[section.type] = (entriesByType[section.type] ?? 0) + 1
      const score = scoreById.get(entry.contentItemId)
      if (typeof score === 'number') visibleScores.push(Math.min(100, score % 1_000_000))
      const item = itemMap.get(entry.contentItemId)
      if (!item) continue
      for (const bullet of visibleBulletList(entry, item)) {
        bulletsVisible += 1
        if (/\d/.test(richPlain(entry.formatting?.richText?.[`bullet:${bullet.id}`] ?? bullet.text))) impactHits += 1
      }
    }
  }
  const avg = visibleScores.length
    ? Math.round(visibleScores.reduce((s, n) => s + n, 0) / visibleScores.length)
    : null
  const covered = markers.filter((marker) =>
    resume.sections.some((section) =>
      section.entries.some((entry) => {
        const item = itemMap.get(entry.contentItemId)
        if (!item) return false
        const resolved = resolveEntry(entry, item)
        const bulletText = visibleBulletList(entry, item)
          .map((b) => richPlain(entry.formatting?.richText?.[`bullet:${b.id}`] ?? b.text))
          .join('\n')
        return containsTerm(`${itemBlob(resolved)}\n${bulletText}`, marker)
      }),
    ),
  )
  const coverage = markers.length ? Math.round((covered.length / markers.length) * 100) : 0

  resume = {
    ...resume,
    alignmentHighlightBulletIds: highlight,
    lastAiBuildStats: {
      builtAtIso: ts,
      targetPages: pages,
      finalPageCount: pageCount,
      finalLastPageFillPercent: lastFill,
      sectionCount: resume.sections.length,
      sectionTitles: resume.sections.map((s) => s.title),
      entriesTotal: resume.sections.reduce((n, s) => n + s.entries.length, 0),
      bulletsVisible,
      entriesByType,
      avgFinalScoreVisible: avg,
      avgRelevanceVisible: avg,
      avgImpactVisible: bulletsVisible ? Math.round((impactHits / bulletsVisible) * 100) : null,
      avgComplexityVisible: null,
      avgCredibilityVisible: null,
      blueprintSectionOrder: order.filter((type) => resume.sections.some((s) => s.type === type)),
      fillTraceAddBullets: addBullets,
      fillTraceRemoveBullets: removeBullets,
      fillTraceAddEntries: addEntries,
      warningsCount: warnings.length,
      languageAlignmentEnabled: align,
      languageAlignmentApplied: align && rewritten > 0,
      bulletsRewrittenCount: rewritten,
      alignmentRejectedCount: rejected,
      skillsNormalizedCount: skillsNormalized,
      alignmentBulletIds: highlight,
      keywordCoveragePct: coverage,
      keywordCoverageMissingCount: Math.max(0, markers.length - covered.length),
    },
  }

  if (pageCount > pages) warnings.push(`This draft still runs about ${pageCount} pages. Trim a section or lower the bullet count.`)
  return { resume, warnings }
}

export function critiqueResume(resume: Resume, items: ContentItem[], jobDescription?: string): Critique {
  const map = new Map(items.map((item) => [item.id, item]))
  const issues: CritiqueIssue[] = []
  let total = 0
  let withMetrics = 0
  let dutyOnly = 0
  const header = resume.sections.find((s) => s.type === 'header')
  const headerItem = header ? map.get(header.entries[0]?.contentItemId ?? '') : undefined
  const email = headerItem?.contactFields?.some((f) => f.type === 'email' && f.value.includes('@'))
  if (!email) {
    issues.push({
      rank: 1,
      severity: 'high',
      criterion: 'ATS',
      section: 'Header',
      issue: 'No email address on the header.',
      fix: 'Add an email in the library header so a parser can find it.',
    })
  }
  for (const section of resume.sections) {
    for (const entry of section.entries) {
      const item = map.get(entry.contentItemId)
      if (!item) {
        issues.push({
          rank: issues.length + 1,
          severity: 'high',
          criterion: 'Consistency',
          section: section.title,
          issue: 'An entry points at a library item that was deleted.',
          fix: 'Remove the entry or restore the library item.',
        })
        continue
      }
      for (const bullet of visibleBulletList(entry, item)) {
        total += 1
        const text = richPlain(entry.formatting?.richText?.[`bullet:${bullet.id}`] ?? bullet.text)
        if (/\d/.test(text)) withMetrics += 1
        else dutyOnly += 1
        if (/^\s*(responsible for|worked on|helped|duties included)/i.test(text)) {
          issues.push({
            rank: issues.length + 1,
            severity: 'medium',
            criterion: 'Impact',
            section: section.title,
            issue: 'A bullet leads with a duty instead of an outcome.',
            fix: 'Start with a verb and the result. Do not invent a number you cannot source.',
          })
        }
        if (text.length > 220) {
          issues.push({
            rank: issues.length + 1,
            severity: 'low',
            criterion: 'Conciseness',
            section: section.title,
            issue: 'A bullet is long enough to bury the point.',
            fix: 'Split it or cut the clause that does not change the claim.',
          })
        }
      }
    }
  }
  const markers = jobDescription ? languageMarkers(jobDescription) : []
  const plain = JSON.stringify(resume.sections)
  const matched = markers.filter((m) => containsTerm(plain, m))
  const gaps = markers.filter((m) => !containsTerm(plain, m))
  const stuffed = matched.filter((m) => {
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    return (plain.match(re) ?? []).length > 6
  })
  if (gaps.length > 4) {
    issues.push({
      rank: issues.length + 1,
      severity: 'medium',
      criterion: 'Keywords',
      section: 'Whole resume',
      issue: `${gaps.length} posting phrases are missing.`,
      fix: 'Turn on wording alignment only where your private notes already support the phrase.',
    })
  }
  const metricRatio = total ? withMetrics / total : 0
  const scores = {
    atsCompatibility: { score: email ? 86 : 42, summary: email ? 'Header has a machine-readable email.' : 'Missing email.' },
    relevance: { score: markers.length ? Math.round((matched.length / markers.length) * 100) : 70, summary: markers.length ? `${matched.length} of ${markers.length} phrases appear.` : 'No posting to compare.' },
    impactAndEvidence: { score: Math.round(40 + metricRatio * 60), summary: `${withMetrics} of ${total} bullets include a figure.` },
    keywordIntegration: { score: markers.length ? Math.max(0, Math.round((matched.length / markers.length) * 100 - stuffed.length * 8)) : 70, summary: stuffed.length ? 'Some phrases repeat often.' : 'No obvious stuffing.' },
    clarityAndSkimmability: { score: dutyOnly > total * 0.7 ? 55 : 80, summary: 'Skim path follows section headings and bullets.' },
    consistency: { score: issues.some((i) => i.criterion === 'Consistency') ? 50 : 84, summary: 'Dates and section labels come from the library.' },
    conciseness: { score: issues.some((i) => i.criterion === 'Conciseness') ? 62 : 82, summary: 'Bullet length is checked against a 220-character skim limit.' },
    truthfulness: { score: 90, summary: 'On-device tailoring will not invent metrics that were not already written.' },
  }
  const overallScore = Math.round(Object.values(scores).reduce((s, row) => s + row.score, 0) / Object.values(scores).length)
  const strengths: string[] = []
  if (email) strengths.push('Contact email is present.')
  if (metricRatio >= 0.4) strengths.push('Several bullets carry evidence.')
  if (resume.sections.length >= 3) strengths.push('The page has a familiar section order.')
  return {
    overallScore,
    scores,
    issues: issues.slice(0, 8),
    keywordAnalysis: markers.length ? { matched, gaps, stuffed } : null,
    bulletStats: { total, withMetrics, dutyOnly, metricNeeded: Math.max(0, dutyOnly - Math.round(total * 0.4)) },
    topStrengths: strengths.length ? strengths : ['Add library items to give the critique more to read.'],
  }
}

export function localCoachReply(message: string, items: ContentItem[]): { reply: string; created: ContentItem[] } {
  const trimmed = message.trim()
  if (!trimmed) return { reply: 'Paste a resume or say “add experience” to start a library item.', created: [] }
  const parsed = parseResumeText(trimmed)
  const rich = parsed.filter((item) => item.type !== 'header')
  if (rich.length > 0 && trimmed.split('\n').length >= 6) {
    return {
      reply: `Added ${parsed.length} library ${parsed.length === 1 ? 'item' : 'items'} from that paste. Review them before you tailor.`,
      created: parsed,
    }
  }
  const command = trimmed.match(/^add\s+(header|experience|education|project|skills|certification|award|volunteer|leadership|extracurricular|custom)\b[:\s-]*(.*)$/i)
  if (command) {
    const type = command[1].toLowerCase() as ContentType
    const title = command[2]?.trim() || `New ${contentTypeLabel(type).toLowerCase()}`
    const created = blankItem(type, { title })
    return { reply: `Created “${title}”. Open it in the library to fill the details.`, created: [created] }
  }
  const count = items.length
  return {
    reply: count
      ? `You have ${count} library ${count === 1 ? 'item' : 'items'}. Paste a resume to import more, or say “add project: name”.`
      : 'The library is empty. Paste a resume, upload a file, or say “add experience: role”.',
    created: [],
  }
}

export function suggestBulletRewrites(item: ContentItem, jobDescription?: string): { id: string; text: string }[] {
  const markers = jobDescription ? languageMarkers(jobDescription) : []
  const context = item.experienceContext ?? ''
  return (item.bullets ?? []).flatMap((bullet) => {
    let text = bullet.text.replace(/\s+/g, ' ').trim()
    text = text.replace(/^(responsible for|duties included:?)\s+/i, '')
    if (text) text = text[0].toUpperCase() + text.slice(1)
    const supported = markers.filter((marker) => containsTerm(context, marker) && !containsTerm(text, marker))
    for (const marker of supported) {
      const candidate = `${text} (${marker})`
      if (!hasNewMetric(bullet.text, candidate) && lengthOk(bullet.text, candidate)) {
        text = candidate
        break
      }
    }
    if (text === bullet.text.trim()) return []
    return [{ id: bullet.id, text }]
  })
}

export function displayField(entry: ResumeEntry, key: string, fallback = ''): { html: string; plain: string } {
  const html = entry.formatting?.richText?.[key]
  if (html && richPlain(html)) return { html, plain: richPlain(html) }
  return { html: escapeHtml(fallback).replace(/\n/g, '<br>'), plain: fallback }
}
