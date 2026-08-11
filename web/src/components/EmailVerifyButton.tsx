import { useState } from 'react'
import { invokeFunction } from '../lib/api'
import {
  liveVerifyTone,
  type LiveVerifyResponse,
} from '../lib/emailVerify'

type Props = {
  email: string
  contactId?: string
  compact?: boolean
  onVerified?: (result: LiveVerifyResponse) => void
}

export function EmailVerifyButton({
  email,
  contactId,
  compact = false,
  onVerified,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LiveVerifyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runVerify() {
    setBusy(true)
    setError(null)
    try {
      const res = await invokeFunction<LiveVerifyResponse>('verify-email', {
        email,
        ...(contactId ? { contact_id: contactId } : {}),
      })
      setResult(res)
      onVerified?.(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  const tone = result
    ? liveVerifyTone(result.deliverable, result.verification_status)
    : null

  return (
    <div className={`email-verify${compact ? ' email-verify-compact' : ''}`}>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy || !email.includes('@')}
        onClick={() => void runVerify()}
      >
        {busy ? 'Checking…' : 'Check deliverability'}
      </button>
      {result && (
        <p className={`email-verify-result tone-${tone}`}>
          {result.label}
          {result.gmail_connected && result.probe_from && (
            <span className="muted small">
              {' '}
              · probe from {result.probe_from} (no email sent)
            </span>
          )}
          {!result.gmail_connected && (
            <span className="muted small"> · no message sent</span>
          )}
        </p>
      )}
      {error && <p className="flash error small">{error}</p>}
    </div>
  )
}
