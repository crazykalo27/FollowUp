import {
  adminClient,
  corsHeaders,
  errorResponse,
  jsonResponse,
  requireUser,
} from '../_shared/cors.ts'
import { verifyEmailLive } from '../_shared/email_verify.ts'
import { buildEmailProvenance } from '../_shared/email_discovery.ts'
import { getGmailAccessToken } from '../_shared/gmail_client.ts'
import { emailSettingsFromFilters } from '../_shared/filterEmailSettings.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const user = await requireUser(req)
    const admin = adminClient()
    const body = await req.json().catch(() => ({})) as {
      email?: string
      contact_id?: string
      method?: 'auto' | 'mx' | 'smtp' | 'hunter' | 'tomba'
    }

    const email = (body.email || '').trim().toLowerCase()
    if (!email || !email.includes('@')) {
      return errorResponse('email is required', 400)
    }

    const { data: filterRow } = await admin
      .from('search_filters')
      .select('filters')
      .eq('user_id', user.id)
      .maybeSingle()

    const settings = emailSettingsFromFilters(
      filterRow?.filters as Record<string, unknown> | undefined,
    )

    let probeFrom: string | null = null
    try {
      const gmail = await getGmailAccessToken(admin, user.id)
      probeFrom = gmail.email
    } catch {
      // Gmail not connected — probe uses default MAIL FROM
    }

    const result = await verifyEmailLive(email, {
      preferSmtp: settings.enable_smtp_verify === true,
      hunterEnabled: settings.enable_hunter === true,
      tombaEnabled: settings.enable_tomba === true,
      mailFrom: probeFrom,
      method: body.method || 'auto',
    })

    if (body.contact_id) {
      const { data: contact } = await admin
        .from('contacts')
        .select('id, source_details, sources')
        .eq('id', body.contact_id)
        .eq('user_id', user.id)
        .maybeSingle()

      if (contact) {
        const prevDetails = (contact.source_details || {}) as Record<string, unknown>
        const provenance = buildEmailProvenance({
          sources: (contact.sources as string[]) || [],
          verification_status: result.verification_status,
          source_details: {
            ...prevDetails,
            live_verify: {
              at: new Date().toISOString(),
              method: result.method_used,
              deliverable: result.deliverable,
              label: result.label,
              detail: result.detail,
              probe_from: result.probe_from,
              no_message_sent: true,
            },
          },
        })

        await admin
          .from('contacts')
          .update({
            verification_status: result.verification_status,
            source_details: {
              ...prevDetails,
              live_verify: {
                at: new Date().toISOString(),
                method: result.method_used,
                deliverable: result.deliverable,
                label: result.label,
                detail: result.detail,
                probe_from: result.probe_from,
                no_message_sent: true,
              },
              email_provenance: provenance,
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', body.contact_id)
          .eq('user_id', user.id)
      }
    }

    return jsonResponse({
      ok: true,
      email,
      verification_status: result.verification_status,
      method_used: result.method_used,
      deliverable: result.deliverable,
      label: result.label,
      detail: result.detail,
      probe_from: result.probe_from,
      gmail_connected: Boolean(probeFrom),
      no_message_sent: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Verification failed'
    if (msg === 'Unauthorized') return errorResponse(msg, 401)
    return errorResponse(msg, 500)
  }
})
