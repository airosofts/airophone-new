import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

// Verifies a phone OTP via Telnyx Verify.

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { phone, code } = await request.json()
    if (!phone || !code) return NextResponse.json({ error: 'Phone and code are required' }, { status: 400 })

    const normalised = phone.replace(/[\s\-()]/g, '')
    const e164 = normalised.startsWith('+') ? normalised : `+${normalised}`

    const apiKey = process.env.TELNYX_API_KEY
    const verifyProfileId = process.env.TELNYX_VERIFY_PROFILE_ID

    if (!apiKey || !verifyProfileId) {
      return NextResponse.json({ error: 'Verification is not configured' }, { status: 503 })
    }

    // Check code against Telnyx Verify
    const res = await fetch(
      `https://api.telnyx.com/v2/verifications/by_phone_number/${encodeURIComponent(e164)}/actions/verify`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          code: code.trim(),
          verify_profile_id: verifyProfileId,
        }),
      }
    )

    const data = await res.json()

    if (!res.ok || data?.data?.response_code !== 'accepted') {
      const detail = data?.errors?.[0]?.detail || data?.data?.response_code || 'Invalid or expired code'
      return NextResponse.json({ error: detail }, { status: 400 })
    }

    // Mark verified in onboarding profile
    await supabaseAdmin
      .from('onboarding_profiles')
      .update({
        whatsapp_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    return NextResponse.json({ success: true, verified: true })
  } catch (error) {
    console.error('[verify-otp] Error:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
