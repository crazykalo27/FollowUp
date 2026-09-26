import {
  newId,
  nowIso,
  templateTheme,
  type BulletStyle,
  type ContentItem,
  type Resume,
  type ResumeEntry,
  type ResumeSection,
  type ResumeTheme,
} from './engine.ts'

export const SECTION_CHOICES: { type: string; title: string }[] = [
  { type: 'summary', title: 'Summary' },
  { type: 'work_experience', title: 'Experience' },
  { type: 'education', title: 'Education' },
  { type: 'skills', title: 'Skills' },
  { type: 'projects', title: 'Projects' },
  { type: 'leadership', title: 'Leadership' },
  { type: 'certifications', title: 'Certifications' },
  { type: 'awards', title: 'Awards' },
  { type: 'volunteer_experience', title: 'Volunteer' },
  { type: 'custom', title: 'Highlights' },
]

function touch(resume: Resume, sections: ResumeSection[]): Resume {
  return { ...resume, sections, updatedAt: nowIso() }
}

function mapEntry(resume: Resume, entryId: string, fn: (entry: ResumeEntry) => ResumeEntry): Resume {
  return touch(
    resume,
    resume.sections.map((section) => ({
      ...section,
      entries: section.entries.map((entry) => (entry.id === entryId ? fn(entry) : entry)),
    })),
  )
}

export function renameResume(resume: Resume, name: string): Resume {
  return { ...resume, name, updatedAt: nowIso() }
}

export function setTemplate(resume: Resume, templateId: string): Resume {
  return { ...resume, templateId, theme: { ...templateTheme(templateId), ...resume.theme }, updatedAt: nowIso() }
}

export function setTheme(resume: Resume, theme: ResumeTheme): Resume {
  return { ...resume, theme, updatedAt: nowIso() }
}

export function setJobDescription(resume: Resume, jobDescription: string, targetPages: number): Resume {
  return { ...resume, jobDescription, targetPages, updatedAt: nowIso() }
}

export function addSection(resume: Resume, type: string, title: string): Resume {
  const section: ResumeSection = {
    id: newId(),
    type,
    title,
    order: resume.sections.length,
    entries: [],
    bulletStyle: 'disc',
  }
  return touch(resume, [...resume.sections, section])
}

export function renameSection(resume: Resume, sectionId: string, title: string): Resume {
  return touch(resume, resume.sections.map((section) => (section.id === sectionId ? { ...section, title } : section)))
}

export function setBulletStyle(resume: Resume, sectionId: string, bulletStyle: BulletStyle): Resume {
  return touch(resume, resume.sections.map((section) => (section.id === sectionId ? { ...section, bulletStyle } : section)))
}

export function removeSection(resume: Resume, sectionId: string): Resume {
  return touch(
    resume,
    resume.sections.filter((section) => section.id !== sectionId).map((section, order) => ({ ...section, order })),
  )
}

export function moveSection(resume: Resume, sectionId: string, direction: -1 | 1): Resume {
  const sections = [...resume.sections].sort((a, b) => a.order - b.order)
  const index = sections.findIndex((section) => section.id === sectionId)
  const next = index + direction
  if (index < 0 || next < 0 || next >= sections.length) return resume
  const copy = [...sections]
  const [row] = copy.splice(index, 1)
  copy.splice(next, 0, row)
  return touch(resume, copy.map((section, order) => ({ ...section, order })))
}

export function addEntry(resume: Resume, sectionId: string, item: ContentItem): Resume {
  return touch(
    resume,
    resume.sections.map((section) => {
      if (section.id !== sectionId) return section
      if (section.entries.some((entry) => entry.contentItemId === item.id)) return section
      const entry: ResumeEntry = { id: newId(), contentItemId: item.id, order: section.entries.length }
      return { ...section, entries: [...section.entries, entry] }
    }),
  )
}

export function removeEntry(resume: Resume, entryId: string): Resume {
  return touch(
    resume,
    resume.sections.map((section) => ({
      ...section,
      entries: section.entries.filter((entry) => entry.id !== entryId).map((entry, order) => ({ ...entry, order })),
    })),
  )
}

export function moveEntry(resume: Resume, entryId: string, direction: -1 | 1): Resume {
  return touch(
    resume,
    resume.sections.map((section) => {
      const entries = [...section.entries].sort((a, b) => a.order - b.order)
      const index = entries.findIndex((entry) => entry.id === entryId)
      const next = index + direction
      if (index < 0 || next < 0 || next >= entries.length) return section
      const copy = [...entries]
      const [row] = copy.splice(index, 1)
      copy.splice(next, 0, row)
      return { ...section, entries: copy.map((entry, order) => ({ ...entry, order })) }
    }),
  )
}

export function duplicateEntry(resume: Resume, entryId: string): Resume {
  return touch(
    resume,
    resume.sections.map((section) => {
      const index = section.entries.findIndex((entry) => entry.id === entryId)
      if (index < 0) return section
      const source = section.entries[index]
      const copy: ResumeEntry = { ...structuredClone(source), id: newId(), order: index + 1 }
      const entries = [...section.entries]
      entries.splice(index + 1, 0, copy)
      return { ...section, entries: entries.map((entry, order) => ({ ...entry, order })) }
    }),
  )
}

export function writeField(resume: Resume, entryId: string, key: string, plain: string, html: string): Resume {
  return mapEntry(resume, entryId, (entry) => {
    if (key.startsWith('bullet:')) {
      const bulletId = key.slice('bullet:'.length)
      const added = entry.addedBullets?.map((bullet) => (bullet.id === bulletId ? { ...bullet, text: plain } : bullet))
      return {
        ...entry,
        addedBullets: added,
        formatting: { ...entry.formatting, richText: { ...entry.formatting?.richText, [key]: html } },
      }
    }
    return {
      ...entry,
      overrides: { ...entry.overrides, [key]: plain },
      formatting: { ...entry.formatting, richText: { ...entry.formatting?.richText, [key]: html } },
    }
  })
}

export function addBullet(resume: Resume, entryId: string): Resume {
  return mapEntry(resume, entryId, (entry) => {
    const bullet = { id: newId(), text: '', order: (entry.addedBullets?.length ?? 0) + 1 }
    const selected = entry.selectedBulletIds ? [...entry.selectedBulletIds, bullet.id] : undefined
    return { ...entry, addedBullets: [...(entry.addedBullets ?? []), bullet], selectedBulletIds: selected }
  })
}

export function removeBullet(resume: Resume, entryId: string, bulletId: string, libraryIds: string[]): Resume {
  return mapEntry(resume, entryId, (entry) => {
    const added = (entry.addedBullets ?? []).filter((bullet) => bullet.id !== bulletId)
    const all = [...libraryIds, ...(entry.addedBullets ?? []).map((bullet) => bullet.id)]
    const selected = (entry.selectedBulletIds ?? all).filter((id) => id !== bulletId)
    const rich = { ...entry.formatting?.richText }
    delete rich[`bullet:${bulletId}`]
    return { ...entry, addedBullets: added, selectedBulletIds: selected, formatting: { ...entry.formatting, richText: rich } }
  })
}

export function clearAlignment(resume: Resume): Resume {
  return { ...resume, alignmentHighlightBulletIds: [], updatedAt: nowIso() }
}
