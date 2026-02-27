import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { validateApiKey } from '@/lib/api-key-auth'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getWorkspaceMessageRate } from '@/lib/pricing'
import telnyx from '@/lib/telnyx'

/**
 * POST /api/external/sms/send
 *
 * External SMS send endpoint — authenticated via API key.
 * Designed for smsablemantool and smsserver to call.
 *
 * Headers:
 *   Authorization: Bearer airo_live_<key>
 *   Content-Type: application/json
 *
 * Body:
 *   {
 *     "from": "+14155551234",   ← sender phone (must belong to this workspace)
 *     "to":   "+19876543210",   ← recipient phone
 *     "message": "Hello!"       ← SMS text (supports {column_id} already resolved by caller)
 *   }
 *
 * Responses:
 *   200 { success: true,  messageId, creditsRemaining }
 *   400 { error: "..." }        ← bad request / missing fields
 *   401 { error: "Unauthorized" }
 *   402 { error: "Insufficient credits", currentCredits, requiredCredits }
 *   500 { error: "..." }
 */
export async function POST(request) {
  // ── 1. Authenticate via API key ──────────────────────────────────────────
  const auth = await validateApiKey(request.headers.get('authorization'))
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized — invalid or missing API key' }, { status: 401 })
  }

  const { userId, workspaceId } = auth

  // ── 2. Parse and validate body ───────────────────────────────────────────
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { from, to, message } = body

  if (!from || !to || !message) {
    return NextResponse.json(
      { error: 'Missing required fields: from, to, message' },
      { status: 400 }
    )
  }

  if (typeof message !== 'string' || message.trim().length === 0) {
    return NextResponse.json({ error: 'message cannot be empty' }, { status: 400 })
  }

  // ── 3. Normalize phone numbers ───────────────────────────────────────────
  const normalizedFrom = normalizePhoneNumber(from)
  const normalizedTo   = normalizePhoneNumber(to)

  if (!normalizedFrom) {
    return NextResponse.json({ error: `Invalid "from" phone number: ${from}` }, { status: 400 })
  }
  if (!normalizedTo) {
    return NextResponse.json({ error: `Invalid "to" phone number: ${to}` }, { status: 400 })
  }

  // ── 4. Verify the "from" number belongs to this workspace ────────────────
  const { data: phoneRecord, error: phoneError } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, phone_number')
    .eq('phone_number', normalizedFrom)
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .single()

  if (phoneError || !phoneRecord) {
    return NextResponse.json(
      { error: `Sender number ${normalizedFrom} is not assigned to this workspace` },
      { status: 403 }
    )
  }

  // ── 5. Check credits ─────────────────────────────────────────────────────
  const messageRate = await getWorkspaceMessageRate(workspaceId)

  const { data: affordCheck, error: affordError } = await supabaseAdmin.rpc(
    'can_afford_message_cost_v2',
    {
      p_user_id: userId,
      p_message_count: 1,
      p_cost_per_message: messageRate
    }
  )

  if (affordError) {
    console.error('[external/sms/send] Credit check error:', affordError)
    return NextResponse.json({ error: 'Failed to verify credit balance' }, { status: 500 })
  }

  if (!affordCheck?.can_afford) {
    return NextResponse.json(
      {
        error: 'Insufficient credits',
        currentCredits: Math.floor(affordCheck?.current_balance || 0),
        requiredCredits: Math.ceil(affordCheck?.required_amount || 1),
        shortage: Math.ceil(affordCheck?.shortage || 1)
      },
      { status: 402 }
    )
  }

  // ── 6. Send SMS via Telnyx ───────────────────────────────────────────────
  const result = await telnyx.sendMessage(normalizedFrom, normalizedTo, message.trim())

  if (!result.success) {
    console.error('[external/sms/send] Telnyx send failed:', result.error)
    return NextResponse.json(
      { error: 'Failed to send SMS', details: result.error },
      { status: 500 }
    )
  }

  // ── 7. Deduct credits ────────────────────────────────────────────────────
  const { data: deductionResult, error: deductionError } = await supabaseAdmin.rpc(
    'deduct_message_cost',
    {
      p_user_id: userId,
      p_workspace_id: workspaceId,
      p_message_count: 1,
      p_cost_per_message: messageRate,
      p_description: `External SMS to ${normalizedTo}`,
      p_campaign_id: null,
      p_message_id: null,
      p_recipient_phone: normalizedTo
    }
  )

  if (deductionError || !deductionResult?.success) {
    // SMS was sent but credit deduction failed — log it but don't fail the response.
    // The caller's message was delivered; billing reconciliation can be done separately.
    console.error('[external/sms/send] Credit deduction failed after send:', deductionError || deductionResult)
  }

  // ── 8. Log to message_transactions ──────────────────────────────────────
  await supabaseAdmin
    .from('message_transactions')
    .insert({
      workspace_id: workspaceId,
      user_id: userId,
      campaign_id: null,
      message_id: null,
      recipient_phone: normalizedTo,
      cost_per_message: messageRate,
      total_cost: messageRate,
      message_type: 'sms',
      status: 'sent'
    })
    .then(() => {})
    .catch((err) => console.error('[external/sms/send] Transaction log failed:', err))

  // ── 9. Return success ────────────────────────────────────────────────────
  const creditsRemaining = deductionResult?.new_balance ?? null

  return NextResponse.json({
    success: true,
    messageId: result.messageId,
    creditsRemaining: creditsRemaining !== null ? Math.floor(creditsRemaining) : null
  })
}
