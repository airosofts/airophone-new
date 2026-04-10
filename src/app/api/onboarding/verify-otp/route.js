import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { code } = await request.json()
    if (!code) return NextResponse.json({ error: 'Verification code is required' }, { status: 400 })

    // Get stored OTP
    const { data: profile } = await supabaseAdmin
      .from('onboarding_profiles')
      .select('otp_code, otp_expires_at')
      .eq('user_id', userId)
      .single()

    if (!profile || !profile.otp_code) {
      return NextResponse.json({ error: 'No verification code found. Please request a new one.' }, { status: 400 })
    }

    if (new Date(profile.otp_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Code has expired. Please request a new one.' }, { status: 400 })
    }

    if (profile.otp_code !== code.trim()) {
      return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 })
    }

    // Mark verified, clear OTP
    await supabaseAdmin
      .from('onboarding_profiles')
      .update({
        phone_verified: true,
        otp_code: null,
        otp_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    return NextResponse.json({ success: true, verified: true })
  } catch (error) {
    console.error('Verify OTP error:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
