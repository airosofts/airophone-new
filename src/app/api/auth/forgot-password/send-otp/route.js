import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const CODE_TTL_MS = 15 * 60 * 1000   // 15 minutes
const RESEND_COOLDOWN_MS = 60 * 1000 // 1 minute between sends

export async function POST(request) {
  try {
    const { email: rawEmail } = await request.json()
    if (!rawEmail) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const email = String(rawEmail).toLowerCase().trim()

    // Look up user. We always return success below to prevent email enumeration —
    // an attacker shouldn't be able to learn which emails have accounts.
    // NOTE: select only columns guaranteed to exist. We intentionally do NOT
    // select `auth_provider` — it may not exist on every deployment, and a
    // missing column fails the whole SELECT. Google accounts are detected via
    // the `password_hash` sentinel below, which is always present.
    const { data: user, error: lookupErr } = await supabaseAdmin
      .from('users')
      .select('id, email, password_reset_sent_at, password_hash')
      .eq('email', email)
      .maybeSingle()

    // A real DB error (e.g. a missing password_reset_* column because the
    // migration wasn't applied) must NOT be silently swallowed as "success" —
    // that returns a fake "we sent a code" while nothing is sent. Surface it.
    if (lookupErr) {
      console.error('[forgot-password/send-otp] user lookup failed:', lookupErr)
      return NextResponse.json({ error: 'Could not start password reset. Please try again.' }, { status: 500 })
    }

    if (!user) {
      return NextResponse.json({ success: true })
    }

    // Google-OAuth accounts have no real password — sending a reset code would
    // be a dead end. Detected via the password_hash sentinel the Google OAuth
    // route writes (`google_oauth_<timestamp>`). Tell them to use Google.
    const isGoogleAccount =
      typeof user.password_hash === 'string' && user.password_hash.startsWith('google_oauth_')
    if (isGoogleAccount) {
      return NextResponse.json({ googleAccount: true })
    }

    // Resend cooldown — protects Resend quota and the user's inbox.
    if (user.password_reset_sent_at) {
      const elapsed = Date.now() - new Date(user.password_reset_sent_at).getTime()
      if (elapsed < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000)
        return NextResponse.json(
          { error: `Please wait ${wait}s before requesting another code.` },
          { status: 429 }
        )
      }
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    const now = new Date()

    const { error: dbError } = await supabaseAdmin
      .from('users')
      .update({
        password_reset_code: code,
        password_reset_expires_at: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
        password_reset_sent_at: now.toISOString(),
        password_reset_attempts: 0,
        updated_at: now.toISOString(),
      })
      .eq('id', user.id)

    if (dbError) {
      console.error('[forgot-password/send-otp] DB error:', dbError)
      return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
    }

    const logoUrl = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'

    const { error: sendError } = await resend.emails.send({
      from: 'AiroPhone <noreply@airophone.com>',
      to: email,
      subject: `${code} is your AiroPhone password reset code`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#F7F6F3;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #E3E1DB;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(19,18,16,0.04);">

    <!-- Header -->
    <div style="padding:24px 32px;border-bottom:1px solid #E3E1DB;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:10px;vertical-align:middle;">
            <img src="${logoUrl}" width="30" height="30" alt="AiroPhone" style="display:block;border-radius:7px;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:15px;font-weight:600;color:#131210;letter-spacing:-0.02em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">AiroPhone</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px 32px;">
      <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:500;color:#D63B1F;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">
        Password reset
      </div>

      <h1 style="margin:0 0 10px;font-size:24px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.15;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Reset your password
      </h1>
      <p style="margin:0 0 32px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Use the code below to reset your AiroPhone password. This code expires in 15 minutes.
      </p>

      <div style="background:#EFEDE8;border:1px solid #E3E1DB;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;">
        <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:36px;font-weight:600;letter-spacing:0.25em;color:#D63B1F;line-height:1;">
          ${code}
        </div>
      </div>

      <div style="height:1px;background:#E3E1DB;margin-bottom:20px;"></div>

      <p style="margin:0;font-size:13px;font-weight:300;color:#9B9890;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        If you didn&rsquo;t request a password reset, you can safely ignore this email &mdash; your password will stay the same.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #E3E1DB;background:#F7F6F3;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;letter-spacing:0.04em;">
            &copy; 2025 AIROSOFTS LLC
          </td>
          <td style="text-align:right;">
            <a href="https://airophone.com" style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;text-decoration:none;letter-spacing:0.04em;">airophone.com</a>
          </td>
        </tr>
      </table>
    </div>
  </div>
</body>
</html>`,
    })

    if (sendError) {
      console.error('[forgot-password/send-otp] Resend error:', sendError)
      return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[forgot-password/send-otp] Unhandled:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
