import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

// POST /api/call-forwarding/sync
// Syncs all active DB forwarding rules to Telnyx native call forwarding
export async function POST() {
  const logs = []
  const log = (msg) => { logs.push(msg); console.log('[fwd-sync]', msg) }

  try {
    const supabase = createSupabaseServerClient()

    // Get all active forwarding rules with phone numbers
    const { data: rules, error } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number, custom_name)')
      .eq('is_active', true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!rules || rules.length === 0) {
      return NextResponse.json({ success: true, message: 'No active forwarding rules to sync', logs })
    }

    log(`Found ${rules.length} active forwarding rule(s)`)

    const results = []

    for (const rule of rules) {
      const phoneNumber = rule.phone_numbers?.phone_number
      if (!phoneNumber) {
        log(`Rule ${rule.id}: no phone number found, skipping`)
        results.push({ rule_id: rule.id, status: 'SKIPPED', reason: 'no phone number' })
        continue
      }

      log(`Syncing rule ${rule.id}: ${phoneNumber} → ${rule.forward_to}`)

      // Find phone on Telnyx
      const listRes = await fetch(
        `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}&page[size]=1`,
        { headers: TELNYX_HEADERS }
      )
      const listData = await listRes.json()
      const telnyxPhone = listData.data?.[0]

      if (!telnyxPhone) {
        log(`Rule ${rule.id}: phone ${phoneNumber} not found on Telnyx`)
        results.push({ rule_id: rule.id, phone: phoneNumber, status: 'FAILED', reason: 'not found on Telnyx' })
        continue
      }

      // Format forward-to number
      const cleanTo = rule.forward_to.replace(/\D/g, '')
      const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`

      // Enable native call forwarding
      const voiceRes = await fetch(
        `https://api.telnyx.com/v2/phone_numbers/${telnyxPhone.id}/voice`,
        {
          method: 'PATCH',
          headers: TELNYX_HEADERS,
          body: JSON.stringify({
            call_forwarding: {
              call_forwarding_enabled: true,
              forwards_to: formattedTo,
              forwarding_type: 'always'
            }
          })
        }
      )
      const voiceData = await voiceRes.json()

      if (voiceRes.ok) {
        log(`Rule ${rule.id}: ENABLED forwarding ${phoneNumber} → ${formattedTo}`)
        results.push({
          rule_id: rule.id,
          phone: phoneNumber,
          forward_to: formattedTo,
          status: 'SYNCED',
          telnyx_phone_id: telnyxPhone.id
        })
      } else {
        log(`Rule ${rule.id}: Telnyx error: ${JSON.stringify(voiceData)}`)
        results.push({
          rule_id: rule.id,
          phone: phoneNumber,
          status: 'FAILED',
          error: voiceData.errors?.[0]?.detail || 'Telnyx API error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      synced: results.filter(r => r.status === 'SYNCED').length,
      total: rules.length,
      results,
      logs
    })
  } catch (error) {
    log(`FATAL: ${error.message}`)
    return NextResponse.json({ error: error.message, logs }, { status: 500 })
  }
}
