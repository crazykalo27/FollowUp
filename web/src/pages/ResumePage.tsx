import { useAuth } from '../lib/auth'
import { ResumeStudio } from '../resume/ResumeStudio'

export function ResumePage() {
  const { user } = useAuth()
  if (!user) return null
  return <ResumeStudio userId={user.id} email={user.email ?? ''} basePath="/app/resume" />
}
