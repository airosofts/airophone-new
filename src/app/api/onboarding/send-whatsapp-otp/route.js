import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

// Sends a phone OTP via Telnyx Verify (works internationally).
// Verify profile: 4900019d-8732-43ed-a475-89086707d646
// To add more countries: Telnyx portal → Verify → AiroPhone Onboarding → add destination

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { phone } = await request.json()
    if (!phone) return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })

    // Normalise to E.164
    const normalised = phone.replace(/[\s\-()]/g, '')
    const e164 = normalised.startsWith('+') ? normalised : `+${normalised}`

    const apiKey = process.env.TELNYX_API_KEY
    const verifyProfileId = process.env.TELNYX_VERIFY_PROFILE_ID

    if (!apiKey || !verifyProfileId) {
      return NextResponse.json({ error: 'Verification is not configured' }, { status: 503 })
    }

    // Store phone against the user's onboarding profile
    await supabaseAdmin
      .from('onboarding_profiles')
      .update({ whatsapp_phone: e164, updated_at: new Date().toISOString() })
      .eq('user_id', userId)

    // Send OTP via Telnyx Verify — handles routing, code generation, expiry
    const res = await fetch('https://api.telnyx.com/v2/verifications/sms', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: e164,
        verify_profile_id: verifyProfileId,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      console.error('[send-otp] Telnyx Verify error:', res.status, JSON.stringify(data))
      const detail = data?.errors?.[0]?.detail || 'Failed to send verification code'
      return NextResponse.json({ error: detail }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[send-otp] Error:', error)
    return NextResponse.json({ error: 'Failed to send verification code' }, { status: 500 })
  }
}
