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

    // Send email via Resend with AiroPhone branded template
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
</head>
<body style="margin:0;padding:0;background:#F7F6F3;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#FFFFFF;border:1px solid #E3E1DB;border-radius:12px;overflow:hidden;">

    <!-- Header -->
    <div style="padding:32px 32px 24px;border-bottom:1px solid #E3E1DB;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding-right:10px;vertical-align:middle;">
            <img src="https://airophone.com/logo.png" width="28" height="28" alt="A" style="display:block;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-size:16px;font-weight:600;color:#131210;letter-spacing:-0.02em;">AiroPhone</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#131210;letter-spacing:-0.03em;">
        Verify your email
      </h1>
      <p style="margin:0 0 28px;font-size:14px;color:#5C5A55;line-height:1.6;">
        Use the code below to complete your AiroPhone account setup. This code expires in 10 minutes.
      </p>

      <!-- Code -->
      <div style="background:#F7F6F3;border:1px solid #E3E1DB;border-radius:10px;padding:20px;text-align:center;margin-bottom:28px;">
        <div style="font-size:36px;font-weight:600;letter-spacing:0.2em;color:#D63B1F;font-family:'Courier New',monospace;">
          ${code}
        </div>
      </div>

      <p style="margin:0;font-size:13px;color:#9B9890;line-height:1.6;">
        If you didn&rsquo;t request this code, you can safely ignore this email. Someone may have entered your email address by mistake.
      </p>
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px;border-top:1px solid #E3E1DB;background:#F7F6F3;">
      <p style="margin:0;font-size:12px;color:#9B9890;line-height:1.5;">
        &copy; 2025 Airosofts LLC &middot; AiroPhone
      </p>
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
