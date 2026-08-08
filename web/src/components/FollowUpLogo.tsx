import { logoUrl } from '../lib/logo'

type FollowUpLogoProps = {
  size?: number
  className?: string
  alt?: string
}

export function FollowUpLogo({
  size = 32,
  className = '',
  alt = 'FollowUp',
}: FollowUpLogoProps) {
  return (
    <img
      src={logoUrl()}
      alt={alt}
      className={`followup-logo ${className}`.trim()}
      width={size}
      height={size}
    />
  )
}
