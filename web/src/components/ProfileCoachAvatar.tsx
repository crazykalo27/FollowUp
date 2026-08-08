import { FollowUpLogo } from './FollowUpLogo'

/** FollowUp mark for coach / assistant UI */
export function ProfileCoachAvatar({ size = 40 }: { size?: number }) {
  return (
    <span
      className="coach-avatar"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <FollowUpLogo size={size} alt="" />
    </span>
  )
}
