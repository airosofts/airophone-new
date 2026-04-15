import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { email } = await request.json()
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000))

    // Store code in onboarding profile
    const { error: dbError } = await supabaseAdmin
      .from('onboarding_profiles')
      .update({
        otp_code: code,
        otp_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)

    if (dbError) {
      console.error('DB error storing OTP:', dbError)
      return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
    }

    // ── Build branded email template ──
    // Brand tokens: Plus Jakarta Sans (--sans), JetBrains Mono (--mono)
    // --bg: #F7F6F3, --bg2: #EFEDE8, --surface: #FFF, --border: #E3E1DB, --border2: #D4D1C9
    // --text: #131210, --text2: #5C5A55, --text3: #9B9890, --red: #D63B1F

    const logoUrl = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'

    const { error: sendError } = await resend.emails.send({
      from: 'AiroPhone <noreply@airophone.com>',
      to: email,
      subject: `${code} is your AiroPhone verification code`,
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
      <!-- Kicker label -->
      <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:10px;font-weight:500;color:#D63B1F;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">
        Email verification
      </div>

      <h1 style="margin:0 0 10px;font-size:24px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.15;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Verify your email
      </h1>
      <p style="margin:0 0 32px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Use the code below to complete your AiroPhone account setup. This code expires in 10 minutes.
      </p>

      <!-- Code — single block, easy to copy -->
      <div style="background:#EFEDE8;border:1px solid #E3E1DB;border-radius:12px;padding:24px;text-align:center;margin-bottom:32px;">
        <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:36px;font-weight:600;letter-spacing:0.25em;color:#D63B1F;line-height:1;">
          ${code}
        </div>
      </div>

      <!-- Divider -->
      <div style="height:1px;background:#E3E1DB;margin-bottom:20px;"></div>

      <p style="margin:0;font-size:13px;font-weight:300;color:#9B9890;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        If you didn&rsquo;t request this code, you can safely ignore this email. Someone may have entered your email address by mistake.
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
      console.error('Resend error:', sendError)
      return NextResponse.json({ error: 'Failed to send verification email' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Send OTP error:', error)
    return NextResponse.json({ error: 'Failed to send verification email' }, { status: 500 })
  }
}
