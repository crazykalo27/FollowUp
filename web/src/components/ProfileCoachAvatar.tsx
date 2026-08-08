/** FollowUp guide mark — matches favicon / brand */
export function ProfileCoachAvatar({ size = 40 }: { size?: number }) {
  return (
    <span
      className="coach-avatar"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="32" height="32" rx="6" fill="#0f1c18" />
        <path
          d="M8 22V10h3.2c2.4 0 3.9 1.3 3.9 3.3 0 1.3-.7 2.3-1.8 2.8L17 22h-3.1l-3.1-5.2H11V22H8zm3-7.8h.9c1.1 0 1.7-.5 1.7-1.4s-.6-1.4-1.7-1.4H11v2.8zM18.2 22l3.4-12h3.3l3.4 12h-3.1l-.6-2.3h-3.7L20.3 22h-2.1zm4.2-4.8h2.4l-1.2-4.5-1.2 4.5z"
          fill="#c4f04c"
        />
      </svg>
    </span>
  )
}
