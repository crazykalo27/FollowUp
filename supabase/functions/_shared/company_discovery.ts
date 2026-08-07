/** Profile-driven company discovery: sectors, recruiter queries, seed graph, listicle filters. */

export type CompanySeed = {
  company_name: string
  domain: string | null
  url: string
  source: string
  hiring_signal?: string | null
  relevance?: number
}

export const SKIP_COMPANY_HOST_PARTS = [
  'indeed.',
  'glassdoor.',
  'ziprecruiter.',
  'monster.',
  'wikipedia.',
  'youtube.',
  'twitter.',
  'x.com',
  'facebook.',
  'reddit.',
  'remotive.',
  'adzuna.',
  'linkedin.com/jobs',
  'linkedin.com/pulse',
  'medium.com',
  'arxiv.org',
  'substack.com',
  'ghost.io',
  'blogspot.',
  'wordpress.com',
  'wixsite.com',
  'squarespace.com',
  'notion.site',
  'github.io',
  'beehiiv.com',
  'mailchimp.',
  'feedburner.',
  'techcrunch.com',
  'forbes.com',
  'businessinsider.com',
  'builtin.com',
  'crunchbase.com',
  'pitchbook.com',
  'cbinsights.com',
  'statista.com',
  'g2.com',
  'ycombinator.com',
  'news.ycombinator',
  'quantamagazine.org',
  'thequantuminsider.com',
  'nature.com/articles',
  'science.org',
  'ieee.org',
  'springer.com',
  'researchgate.net',
  'semiconductor-digest.com',
  'venturebeat.com',
  'prnewswire.com',
  'businesswire.com',
  'companiesmarketcap.',
  'companiesmarketcap.com',
  'finance.yahoo.',
  'yahoo.com/finance',
  'stockanalysis.com',
  'macrotrends.net',
  'investing.com',
  'marketwatch.com',
  'nasdaq.com/market-activity',
  'fool.com',
  'seekingalpha.com',
  'etf.com',
  'etfdb.com',
  'listful.com',
  'ranking.',
  'top10.',
  'top100.',
  'wellfound.com/jobs',
  'angel.co/jobs',
  'linkedin.com/in/',
]

const LISTICLE_TITLE_RE =
  /\b(top\s*\d+|best\s*\d+|\d+\s+(best|top|leading|largest)|list of|largest\b|market\s*cap|ranking|ranked|fortune\s*500|stock\b|etf\b|newsletter|podcast|webinar|interview with|how to|guide to|what is|ultimate guide|roundup|magazine|weekly|daily digest|blog\b|vs\.|review\b|careers page|job board|companies to watch|to know in)\b/i

/** Technology tokens → recruiter-style sector labels (not broad "hardware"). */
const TECH_TO_SECTORS: Array<{ re: RegExp; sectors: string[] }> = [
  {
    re: /\brisc[\s-]?v\b/i,
    sectors: ['CPU Design', 'Embedded Systems', 'Semiconductor Design'],
  },
  {
    re: /\b(fpga|xilinx|altera)\b/i,
    sectors: ['FPGA', 'Semiconductor Design'],
  },
  {
    re: /\b(asic|rtl|verilog|systemverilog|vhdl)\b/i,
    sectors: ['ASIC Design', 'Semiconductor Design'],
  },
  {
    re: /\b(microarchitecture|computer architecture|cpu design|processor design)\b/i,
    sectors: ['CPU Design', 'Processor Architecture'],
  },
  {
    re: /\b(gpu|cuda|tensor core|ai accelerator|npu|tpu)\b/i,
    sectors: ['AI Hardware', 'GPU Architecture'],
  },
  {
    re: /\b(embedded|soc|firmware|bare metal)\b/i,
    sectors: ['Embedded Systems', 'Semiconductor Design'],
  },
  {
    re: /\b(hpc|parallel computing|mpi|openmp)\b/i,
    sectors: ['High Performance Computing', 'Cloud Infrastructure'],
  },
  {
    re: /\b(quantum|qubit|superconducting)\b/i,
    sectors: ['Quantum Computing', 'Research Labs'],
  },
  {
    re: /\b(eda|synopsys|cadence|verification)\b/i,
    sectors: ['EDA Software'],
  },
  {
    re: /\b(datacenter|silicon|chip design|semiconductor)\b/i,
    sectors: ['Semiconductor Design', 'Datacenter Silicon'],
  },
  {
    re: /\b(compiler|llvm|ir\b)/i,
    sectors: ['Systems Software', 'AI Hardware'],
  },
]

const COMPANY_GRAPH: Record<
  string,
  Array<{ name: string; domain?: string }>
> = {
  'CPU Design': [
    { name: 'Intel', domain: 'intel.com' },
    { name: 'AMD', domain: 'amd.com' },
    { name: 'Apple', domain: 'apple.com' },
    { name: 'Arm', domain: 'arm.com' },
    { name: 'SiFive', domain: 'sifive.com' },
    { name: 'Ampere Computing', domain: 'amperecomputing.com' },
    { name: 'Tenstorrent', domain: 'tenstorrent.com' },
  ],
  'AI Hardware': [
    { name: 'NVIDIA', domain: 'nvidia.com' },
    { name: 'Cerebras', domain: 'cerebras.ai' },
    { name: 'Groq', domain: 'groq.com' },
    { name: 'Tenstorrent', domain: 'tenstorrent.com' },
    { name: 'Esperanto', domain: 'esperanto.ai' },
    { name: 'Qualcomm', domain: 'qualcomm.com' },
  ],
  'GPU Architecture': [
    { name: 'NVIDIA', domain: 'nvidia.com' },
    { name: 'AMD', domain: 'amd.com' },
    { name: 'Intel', domain: 'intel.com' },
  ],
  FPGA: [
    { name: 'AMD', domain: 'amd.com' },
    { name: 'Intel', domain: 'intel.com' },
    { name: 'Lattice Semiconductor', domain: 'latticesemi.com' },
  ],
  'EDA Software': [
    { name: 'Synopsys', domain: 'synopsys.com' },
    { name: 'Cadence', domain: 'cadence.com' },
    { name: 'Siemens EDA', domain: 'eda.sw.siemens.com' },
  ],
  'Quantum Computing': [
    { name: 'IBM', domain: 'ibm.com' },
    { name: 'IonQ', domain: 'ionq.com' },
    { name: 'PsiQuantum', domain: 'psiquantum.com' },
    { name: 'Rigetti', domain: 'rigetti.com' },
  ],
  'Embedded Systems': [
    { name: 'NXP', domain: 'nxp.com' },
    { name: 'STMicroelectronics', domain: 'st.com' },
    { name: 'Nordic Semiconductor', domain: 'nordicsemi.com' },
    { name: 'Microchip', domain: 'microchip.com' },
    { name: 'Marvell', domain: 'marvell.com' },
  ],
  'Semiconductor Design': [
    { name: 'Broadcom', domain: 'broadcom.com' },
    { name: 'Marvell', domain: 'marvell.com' },
    { name: 'MediaTek', domain: 'mediatek.com' },
  ],
  'High Performance Computing': [
    { name: 'HPE', domain: 'hpe.com' },
    { name: 'AWS', domain: 'aws.amazon.com' },
    { name: 'Google Cloud', domain: 'cloud.google.com' },
  ],
  'Cloud Infrastructure': [
    { name: 'Microsoft', domain: 'microsoft.com' },
    { name: 'Google', domain: 'google.com' },
    { name: 'Amazon', domain: 'amazon.com' },
  ],
  'Research Labs': [
    { name: 'Sandia National Laboratories', domain: 'sandia.gov' },
    { name: 'Lawrence Livermore National Laboratory', domain: 'llnl.gov' },
  ],
}

const RECRUITER_QUERY_TEMPLATES = [
  (t: string) => `${t} startup`,
  (t: string) => `${t} company`,
  (t: string) => `processor design ${t}`,
  (t: string) => `ASIC design ${t}`,
  (t: string) => `chip design ${t}`,
  (t: string) => `("computer architecture" OR microarchitecture) ${t}`,
  (t: string) => `AI accelerator ${t}`,
  (t: string) => `embedded processor ${t}`,
  (t: string) => `RTL design ${t}`,
  (t: string) => `hardware acceleration ${t}`,
  (t: string) => `datacenter silicon ${t}`,
]

const DATABASE_SOURCE_TEMPLATES = [
  (t: string) => `site:crunchbase.com ${t}`,
  (t: string) => `site:wellfound.com ${t}`,
  (t: string) => `site:linkedin.com/company ${t}`,
  (t: string) => `site:yc.com ${t} semiconductor`,
]

export function isSkippableCompanyHost(host: string): boolean {
  const h = host.toLowerCase()
  return SKIP_COMPANY_HOST_PARTS.some((p) => h.includes(p))
}

export function isEmployerCorporateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  if (!h || isSkippableCompanyHost(h)) return false
  if (h.endsWith('.substack.com') || h === 'substack.com') return false
  if (h.endsWith('.github.io') || h.endsWith('.wordpress.com')) return false
  const parts = h.split('.')
  if (parts.length < 2) return false
  const tld = parts[parts.length - 1]
  if (!/^[a-z]{2,}$/i.test(tld)) return false
  return true
}

export function isListicleOrPublisherTitle(text: string): boolean {
  const t = text.trim()
  if (!t || t.length < 2) return true
  if (LISTICLE_TITLE_RE.test(t)) return true
  if (/^\d{4}\s/.test(t)) return true
  return false
}

export function looksLikeEmployerName(name: string): boolean {
  const n = name.trim()
  if (n.length < 2 || n.length > 80) return false
  if (isListicleOrPublisherTitle(n)) return false
  const lower = n.toLowerCase()
  if (
    /\b(newsletter|blog|magazine|journal|insider|digest|podcast|substack|medium|market\s*cap|ranking|etf|wikipedia)\b/.test(
      lower,
    )
  ) {
    return false
  }
  if (/^(the|a)\s+\d+/i.test(n)) return false
  return true
}

function profileBlob(
  industries: string[],
  companyTypes: string[],
  skills: string[],
  roles: string[],
): string {
  return [...industries, ...companyTypes, ...skills, ...roles].join(' ')
}

/** Infer sector labels from profile text (skills + industries), not generic "hardware". */
export function inferDiscoverySectors(
  industries: string[],
  companyTypes: string[],
  skills: string[],
  roles: string[],
): string[] {
  const blob = profileBlob(industries, companyTypes, skills, roles)
  const sectors = new Set<string>()

  for (const ind of industries) {
    const i = ind.trim()
    if (i && !/^computer hardware$/i.test(i)) sectors.add(i)
  }
  for (const ct of companyTypes) {
    const c = ct.trim()
    if (c) sectors.add(c)
  }

  for (const { re, sectors: mapped } of TECH_TO_SECTORS) {
    if (re.test(blob)) {
      for (const s of mapped) sectors.add(s)
    }
  }

  return [...sectors].slice(0, 12)
}

export function seedCompaniesFromKnowledgeGraph(
  industries: string[],
  companyTypes: string[],
  skills: string[],
  roles: string[],
  scoreFit: (name: string, signal: string | null) => number,
): CompanySeed[] {
  const blob = profileBlob(industries, companyTypes, skills, roles)
  const sectors = inferDiscoverySectors(
    industries,
    companyTypes,
    skills,
    roles,
  )
  const matchedCategories = new Set<string>()
  for (const sector of sectors) {
    const key = Object.keys(COMPANY_GRAPH).find(
      (k) =>
        k.toLowerCase() === sector.toLowerCase() ||
        sector.toLowerCase().includes(k.toLowerCase()) ||
        k.toLowerCase().includes(sector.toLowerCase()),
    )
    if (key) matchedCategories.add(key)
  }

  if (matchedCategories.size === 0) {
    for (const { re, sectors: mapped } of TECH_TO_SECTORS) {
      if (!re.test(blob)) continue
      for (const s of mapped) {
        if (COMPANY_GRAPH[s]) matchedCategories.add(s)
      }
    }
  }

  const out: CompanySeed[] = []
  const seen = new Set<string>()
  for (const cat of matchedCategories) {
    const entries = COMPANY_GRAPH[cat] || []
    for (const e of entries) {
      const key = e.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const relevance = scoreFit(e.name, `seed:${cat}`) + 6
      out.push({
        company_name: e.name,
        domain: e.domain || null,
        url: e.domain ? `https://${e.domain.replace(/^www\./, '')}/` : '',
        source: 'knowledge_graph',
        hiring_signal: null,
        relevance,
      })
    }
  }
  return out.sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
}

/**
 * Recruiter-style discovery queries: technologies → sectors → targeted searches + DB sites.
 * Avoids broad patterns like "{industry} hardware companies".
 */
export function buildCompanyDiscoveryQueries(
  industries: string[],
  roles: string[],
  companyTypes: string[],
  skills: string[],
): string[] {
  const queries: string[] = []
  const sectors = inferDiscoverySectors(industries, companyTypes, skills, roles)
  const blob = profileBlob(industries, companyTypes, skills, roles)

  const ctLower = companyTypes.map((c) => c.toLowerCase())
  const wantsStartup = ctLower.some((c) =>
    /startup|early|seed|series|venture|unicorn/i.test(c),
  )
  const wantsLab = ctLower.some((c) =>
    /lab|national|research institute|academia|university/i.test(c),
  )

  const sectorTerms = sectors.slice(0, 8)
  for (const sector of sectorTerms) {
    const s = sector.trim()
    if (!s || /^computer hardware$/i.test(s)) continue
    for (const tmpl of RECRUITER_QUERY_TEMPLATES.slice(0, 4)) {
      queries.push(tmpl(s))
    }
    if (wantsStartup) queries.push(`${s} startup`)
    if (wantsLab) queries.push(`${s} research lab`)
    for (const db of DATABASE_SOURCE_TEMPLATES) {
      queries.push(db(s))
    }
  }

  const techPhrases: Array<{ re: RegExp; query: string }> = [
    { re: /\brisc[\s-]?v\b/i, query: 'RISC-V startup' },
    { re: /\brisc[\s-]?v\b/i, query: 'RISC-V company' },
    { re: /\b(fpga)\b/i, query: 'FPGA startup' },
    { re: /\b(asic|rtl)\b/i, query: 'ASIC design company' },
    {
      re: /\b(microarchitecture|computer architecture)\b/i,
      query: 'CPU architecture company',
    },
    {
      re: /\b(microarchitecture|computer architecture)\b/i,
      query: 'processor architecture company',
    },
    { re: /\b(ai accelerator|npu|tpu)\b/i, query: 'AI accelerator startup' },
    { re: /\b(embedded)\b/i, query: 'embedded processor company' },
    { re: /\b(quantum)\b/i, query: 'quantum computing hardware company' },
    { re: /\b(cache coherence)\b/i, query: 'cache coherence company' },
    { re: /\b(verification)\b/i, query: 'processor verification company' },
  ]
  for (const { re, query } of techPhrases) {
    if (re.test(blob)) queries.push(query)
  }

  for (const role of roles.slice(0, 2)) {
    const r = role.trim()
    if (r) queries.push(`${r} employer semiconductor`)
  }

  if (queries.length === 0) {
    for (const ind of industries.slice(0, 3)) {
      const i = ind.trim()
      if (i) queries.push(`site:linkedin.com/company ${i}`)
    }
  }

  const seen = new Set<string>()
  return queries
    .filter((q) => {
      const key = q.toLowerCase().trim()
      if (!key || seen.has(key)) return false
      if (/\bhardware companies\b/i.test(key) && !/\b(ai|quantum|embedded)\b/i.test(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

/** How many industry web searches to run per planning phase (by search depth). */
export function companyWebSearchQueryBudget(depth: string): number {
  if (depth === 'quick') return 5
  if (depth === 'deep') return 10
  return 8
}
