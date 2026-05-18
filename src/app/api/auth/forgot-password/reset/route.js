import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const { email: rawEmail, code: rawCode, password } = await request.json()
    if (!rawEmail || !rawCode || !password) {
      return NextResponse.json({ error: 'Email, code, and new password are required' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    const email = String(rawEmail).toLowerCase().trim()
    const code = String(rawCode).trim()

    const { data: user } = await supabaseAdmin
      .from('users')
      .select('id, password_reset_code, password_reset_expires_at')
      .eq('email', email)
      .maybeSingle()

    if (!user || !user.password_reset_code) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
    }

    if (new Date(user.password_reset_expires_at) < new Date()) {
      return NextResponse.json({ error: 'Code has expired. Please request a new one.' }, { status: 400 })
    }

    if (user.password_reset_code !== code) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    // Match the storage format used by signup/login (plain in password_hash).
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        password_hash: password,
        password_reset_code: null,
        password_reset_expires_at: null,
        password_reset_sent_at: null,
        password_reset_attempts: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (updateError) {
      console.error('[forgot-password/reset] Update error:', updateError)
      return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[forgot-password/reset] Unhandled:', error)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
