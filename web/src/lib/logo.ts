/** Public logo path (respects Vite `base` for GitHub Pages). */
export function logoUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base
  return `${prefix}/logo.png`
}
