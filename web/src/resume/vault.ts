import {
  countCreatedOnUtcDay,
  creationGate,
  newId,
  nowIso,
  templateTheme,
  type ContentItem,
  type JobApplication,
  type Resume,
  type Tag,
} from './engine.ts'
import { supabase } from '../lib/supabase'

export interface VaultProfile {
  firstName: string
  lastName: string
}

export interface VaultBilling {
  plan: 'free' | 'pro'
  resumeCredits: number
}

export interface Vault {
  items: ContentItem[]
  tags: Tag[]
  resumes: Resume[]
  applications: JobApplication[]
  billing: VaultBilling
  profile: VaultProfile
  updatedAt: string
}

export class ResumeLimitError extends Error {
  constructor() {
    super('Free plan includes one new resume per UTC day. Use a credit or upgrade to add another today.')
    this.name = 'ResumeLimitError'
  }
}

const TAG_COLORS = ['#c4f04c', '#9ad7ff', '#ffb086', '#e7c4ff', '#ffd6a5']

export function emptyVault(): Vault {
  return {
    items: [],
    tags: [],
    resumes: [],
    applications: [],
    billing: { plan: 'free', resumeCredits: 0 },
    profile: { firstName: '', lastName: '' },
    updatedAt: '1970-01-01T00:00:00.000Z',
  }
}

export function blankResume(name: string): Resume {
  const ts = nowIso()
  return {
    id: newId(),
    name: name.trim() || 'Untitled resume',
    templateId: 'professional',
    sections: [],
    theme: templateTheme('professional'),
    targetPages: 1,
    createdAt: ts,
    updatedAt: ts,
  }
}

function storageKey(userId: string): string {
  return `followup.resumeVault.v1:${userId}`
}

function isVault(value: unknown): value is Vault {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<Vault>
  return Array.isArray(row.items) && Array.isArray(row.resumes) && Array.isArray(row.applications) && !!row.billing && !!row.profile
}

export function loadLocal(userId: string): Vault | null {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isVault(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveLocal(userId: string, vault: Vault) {
  localStorage.setItem(storageKey(userId), JSON.stringify(vault))
}

function stamp(vault: Vault): Vault {
  return { ...vault, updatedAt: nowIso() }
}

function withTags(vault: Vault, names: string[]): Vault {
  const have = new Set(vault.tags.map((tag) => tag.name.toLowerCase()))
  const added: Tag[] = []
  for (const name of names) {
    const clean = name.trim()
    if (!clean || have.has(clean.toLowerCase())) continue
    have.add(clean.toLowerCase())
    added.push({
      id: newId(),
      name: clean,
      color: TAG_COLORS[(vault.tags.length + added.length) % TAG_COLORS.length],
    })
  }
  return added.length ? { ...vault, tags: [...vault.tags, ...added] } : vault
}

export function saveItem(vault: Vault, item: ContentItem, isNew: boolean): Vault {
  const next = { ...item, tags: item.tags.map((tag) => tag.trim()).filter(Boolean), updatedAt: nowIso() }
  const items = isNew ? [...vault.items, next] : vault.items.map((row) => (row.id === next.id ? next : row))
  return stamp(withTags({ ...vault, items }, next.tags))
}

export function deleteItems(vault: Vault, ids: string[]): Vault {
  const drop = new Set(ids)
  return stamp({ ...vault, items: vault.items.filter((item) => !drop.has(item.id)) })
}

export function duplicateItems(vault: Vault, ids: string[]): Vault {
  const copies = vault.items.filter((item) => ids.includes(item.id)).map((item) => {
    const ts = nowIso()
    return {
      ...structuredClone(item),
      id: newId(),
      title: `${item.title ?? 'Item'} (Copy)`,
      createdAt: ts,
      updatedAt: ts,
      bullets: item.bullets?.map((bullet) => ({ ...bullet, id: newId() })),
    }
  })
  return stamp({ ...vault, items: [...vault.items, ...copies] })
}

export function addItems(vault: Vault, items: ContentItem[]): Vault {
  let next = vault
  for (const item of items) next = saveItem(next, item, true)
  return next
}

export function replaceItems(vault: Vault, items: ContentItem[]): Vault {
  return stamp({ ...vault, items })
}

function assertGate(vault: Vault) {
  const gate = creationGate({
    plan: vault.billing.plan,
    resumeCredits: vault.billing.resumeCredits,
    resumesCreatedTodayUtc: countCreatedOnUtcDay(vault.resumes.map((resume) => resume.createdAt)),
  })
  if (!gate.ok) throw new ResumeLimitError()
  return gate
}

export function insertResume(vault: Vault, resume: Resume): { vault: Vault; resume: Resume } {
  const gate = assertGate(vault)
  const ts = nowIso()
  const stored: Resume = { ...resume, createdAt: ts, updatedAt: ts }
  const billing = gate.usesCredit
    ? { ...vault.billing, resumeCredits: Math.max(0, vault.billing.resumeCredits - 1) }
    : vault.billing
  return { resume: stored, vault: stamp({ ...vault, billing, resumes: [...vault.resumes, stored] }) }
}

export function updateResume(vault: Vault, resume: Resume): Vault {
  return stamp({
    ...vault,
    resumes: vault.resumes.map((row) => (row.id === resume.id ? { ...resume, updatedAt: nowIso() } : row)),
  })
}

export function deleteResume(vault: Vault, id: string): Vault {
  return stamp({ ...vault, resumes: vault.resumes.filter((resume) => resume.id !== id) })
}

export function duplicateResume(vault: Vault, id: string): { vault: Vault; resume: Resume } {
  const original = vault.resumes.find((resume) => resume.id === id)
  if (!original) throw new Error('That resume is missing.')
  const copy = blankResume(`${original.name} (Copy)`)
  copy.templateId = original.templateId
  copy.sections = structuredClone(original.sections)
  copy.theme = structuredClone(original.theme)
  copy.jobDescription = original.jobDescription
  copy.targetPages = original.targetPages
  return insertResume(vault, copy)
}

export function saveApplication(vault: Vault, application: JobApplication, isNew: boolean): Vault {
  const next = { ...application, updatedAt: nowIso() }
  const applications = isNew
    ? [...vault.applications, next]
    : vault.applications.map((row) => (row.id === next.id ? next : row))
  return stamp({ ...vault, applications })
}

export function deleteApplication(vault: Vault, id: string): Vault {
  return stamp({ ...vault, applications: vault.applications.filter((row) => row.id !== id) })
}

export function setProfile(vault: Vault, profile: VaultProfile): Vault {
  return stamp({ ...vault, profile })
}

export function setBilling(vault: Vault, billing: VaultBilling): Vault {
  return stamp({ ...vault, billing })
}

export async function pullVault(userId: string): Promise<Vault | null> {
  const { data, error } = await supabase
    .from('resume_vault')
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { data?: unknown; updated_at?: string }
  if (!isVault(row.data)) return null
  return { ...row.data, updatedAt: row.updated_at || row.data.updatedAt }
}

export async function pushVault(userId: string, vault: Vault): Promise<boolean> {
  const { error } = await supabase.from('resume_vault').upsert({
    user_id: userId,
    data: vault,
    updated_at: vault.updatedAt,
  })
  return !error
}
