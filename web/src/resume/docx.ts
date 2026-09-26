import {
  bulletGlyph,
  dateRangeLabel,
  displayField,
  resolveEntry,
  richPlain,
  visibleBullets,
  type ContentItem,
  type Resume,
  type ResumeEntry,
} from './engine.ts'

function crc32(data: Uint8Array): number {
  let c = ~0
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >> 8) & 255)
}

function u32(n: number): Uint8Array {
  return Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255)
}

/** Store-only zip. Enough for Word to open a small document. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const crc = crc32(file.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ])
    locals.push(local)
    centrals.push(concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]))
    offset += local.length
  }
  const central = concat(centrals)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ])
  return concat([...locals, central, end])
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function runs(entry: ResumeEntry, key: string, fallback: string, opts?: { bold?: boolean; size?: number; color?: string }): string {
  const plain = displayField(entry, key, fallback).plain
  const size = opts?.size ?? 21
  const color = (opts?.color ?? '222222').replace('#', '')
  const bold = opts?.bold ? '<w:b/>' : ''
  return `<w:r><w:rPr>${bold}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(plain)}</w:t></w:r>`
}

function paragraph(inner: string, after = 60): string {
  return `<w:p><w:pPr><w:spacing w:after="${after}"/></w:pPr>${inner}</w:p>`
}

function entryPlain(entry: ResumeEntry, item: ContentItem): string[] {
  const resolved = resolveEntry(entry, item)
  const lines: string[] = []
  const title = displayField(entry, 'title', resolved.title ?? '').plain
  const org = displayField(entry, 'organization', resolved.organization ?? '').plain
  const dates = dateRangeLabel(resolved)
  if (title || org) lines.push([title, org, dates].filter(Boolean).join(' — '))
  const subtitle = displayField(entry, 'subtitle', resolved.subtitle ?? '').plain
  if (subtitle) lines.push(subtitle)
  const description = displayField(entry, 'description', resolved.description ?? '').plain
  if (description) lines.push(description)
  for (const group of resolved.skillGroups ?? []) {
    if (group.skills.length) lines.push(`${group.category}: ${group.skills.join(', ')}`)
  }
  for (const field of resolved.contactFields ?? []) {
    if (field.value) lines.push(field.value)
  }
  for (const link of resolved.links ?? []) {
    if (link.url) lines.push(link.label ? `${link.label}: ${link.url}` : link.url)
  }
  const glyph = bulletGlyph('disc')
  for (const bullet of visibleBullets(entry, item)) {
    const text = richPlain(entry.formatting?.richText?.[`bullet:${bullet.id}`] ?? bullet.text)
    if (text) lines.push(`${glyph} ${text}`)
  }
  return lines
}

export function buildDocx(resume: Resume, items: ContentItem[]): Uint8Array {
  const map = new Map(items.map((item) => [item.id, item]))
  const body: string[] = []
  const accent = (resume.theme?.accentColor ?? '222222').replace('#', '')
  for (const section of [...resume.sections].sort((a, b) => a.order - b.order)) {
    const entries = [...section.entries].sort((a, b) => a.order - b.order)
    const isHeader = section.type === 'header'
    if (!isHeader) {
      body.push(paragraph(runs({ id: '', contentItemId: '', order: 0 }, 'title', section.title, { bold: true, size: 24, color: accent }), 80))
    }
    for (const entry of entries) {
      const item = map.get(entry.contentItemId)
      if (!item) continue
      const resolved = resolveEntry(entry, item)
      if (isHeader) {
        body.push(paragraph(runs(entry, 'title', resolved.title ?? resume.name, { bold: true, size: 36, color: accent }), 40))
        if (resolved.subtitle) body.push(paragraph(runs(entry, 'subtitle', resolved.subtitle), 40))
        const contacts = (resolved.contactFields ?? []).map((f) => f.value).filter(Boolean).join('  ·  ')
        if (contacts) body.push(paragraph(`<w:r><w:t xml:space="preserve">${xml(contacts)}</w:t></w:r>`, 120))
        continue
      }
      for (const line of entryPlain(entry, item)) {
        body.push(paragraph(`<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`, 40))
      }
    }
  }
  if (body.length === 0) {
    body.push(paragraph(`<w:r><w:t>${xml(resume.name || 'Resume')}</w:t></w:r>`))
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>`
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  const enc = new TextEncoder()
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(document) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
  ])
}
