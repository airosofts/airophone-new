import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

const MAX_ATTEMPTS = 5

export async function POST(request) {
  try {
    const { email: rawEmail, code: rawCode } = await request.json()
    if (!rawEmail || !rawCode) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }

    const email = String(rawEmail).toLowerCase().trim()
    const code = String(rawCode).trim()

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, password_reset_code, password_reset_expires_at, password_reset_attempts')
      .eq('email', email)
      .maybeSingle()

    // Generic message — don't leak whether the email exists.
    if (!user || !user.password_reset_code) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
    }

    if (new Date(user.password_reset_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Code has expired. Please request a new one.' }, { status: 400 })
    }

    if ((user.password_reset_attempts ?? 0) >= MAX_ATTEMPTS) {
      // Burn the code — user must request a fresh one.
      await supabaseAdmin
        .from('users')
        .update({
          password_reset_code: null,
          password_reset_expires_at: null,
          password_reset_attempts: 0,
        })
        .eq('id', user.id)
      return NextResponse.json(
        { error: 'Too many attempts. Please request a new code.' },
        { status: 429 }
      )
    }

    if (user.password_reset_code !== code) {
      await supabaseAdmin
        .from('users')
        .update({ password_reset_attempts: (user.password_reset_attempts ?? 0) + 1 })
        .eq('id', user.id)
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Don't clear the code yet — the reset route needs it to re-verify before
    // updating the password. Just confirm the code is good.
    return NextResponse.json({ success: true, verified: true })
  } catch (error) {
    console.error('[forgot-password/verify-otp] Unhandled:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
