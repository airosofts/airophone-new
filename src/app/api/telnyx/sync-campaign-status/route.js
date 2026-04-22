// Syncs 10DLC campaign_status from Telnyx for all pending phone numbers in a workspace
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { Resend } from 'resend'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const CAMPAIGN_ID = process.env.TELNYX_CAMPAIGN_ID || '4b300199-1bcf-170e-e865-65d3d884f545'
const resend = new Resend(process.env.RESEND_API_KEY)
const logoUrl = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'

async function sendNumberApprovedEmail(email, name, phoneNumber) {
  const firstName = name?.split(' ')[0] || name || 'there'
  const formatted = phoneNumber?.replace(/(\+1)(\d{3})(\d{3})(\d{4})/, '($2) $3-$4') || phoneNumber
  await resend.emails.send({
    from: 'AiroPhone <noreply@airophone.com>',
    to: email,
    subject: 'Your AiroPhone number is ready to send SMS',
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
        Number activated
      </div>

      <h1 style="margin:0 0 10px;font-size:22px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.2;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Your number is all set, ${firstName}
      </h1>
      <p style="margin:0 0 24px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Great news — your phone number has been approved by the carriers and is now fully active for both SMS and calls.
      </p>

      <!-- Number box -->
      <div style="background:#F7F6F3;border:1px solid #E3E1DB;border-radius:10px;padding:18px 20px;margin-bottom:28px;text-align:center;">
        <div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:22px;font-weight:500;color:#131210;letter-spacing:0.04em;">
          ${formatted}
        </div>
        <div style="margin-top:6px;font-size:12px;color:#9B9890;font-family:'JetBrains Mono','Courier New',monospace;letter-spacing:0.04em;">
          SMS &amp; calls active
        </div>
      </div>

      <!-- CTA -->
      <a href="https://app.airophone.com/inbox" style="display:block;background:#D63B1F;color:#FFFFFF;text-align:center;padding:13px 24px;border-radius:9px;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:-0.01em;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        Start messaging
      </a>
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
  }).catch(err => console.warn('[sync-campaign] Approval email failed (non-critical):', err.message))
}

export async function POST(request) {
  try {
    const workspaceId = request.headers.get('x-workspace-id')
    if (!workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Get all phone numbers for this workspace that are not yet approved
    const { data: numbers, error } = await supabaseAdmin
      .from('phone_numbers')
      .select('id, phone_number, campaign_status')
      .eq('workspace_id', workspaceId)
      .or('campaign_status.neq.approved,campaign_status.is.null')

    if (error || !numbers?.length) {
      return NextResponse.json({ success: true, synced: 0 })
    }

    let synced = 0

    for (const row of numbers) {
      const phone = row.phone_number
      if (!phone) continue

      try {
        const res = await fetch(
          `https://api.telnyx.com/v2/10dlc/phone_number_campaigns/${encodeURIComponent(phone)}`,
          { headers: { Authorization: `Bearer ${TELNYX_API_KEY}` } }
        )

        if (!res.ok) continue

        const data = await res.json()
        const assignmentStatus = data.assignmentStatus

        let newStatus = null
        if (assignmentStatus === 'ASSIGNED') newStatus = 'approved'
        else if (assignmentStatus === 'FAILED') newStatus = 'rejected'
        else if (assignmentStatus === 'PENDING_ASSIGNMENT') newStatus = 'pending'

        if (newStatus && newStatus !== row.campaign_status) {
          await supabaseAdmin
            .from('phone_numbers')
            .update({ campaign_status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', row.id)
          synced++
          console.log(`[sync-campaign-status] ${phone}: ${row.campaign_status} → ${newStatus}`)

          // Send approval email when number flips to approved
          if (newStatus === 'approved') {
            try {
              const { data: ws } = await supabaseAdmin
                .from('workspaces')
                .select('created_by')
                .eq('id', workspaceId)
                .single()
              if (ws?.created_by) {
                const { data: owner } = await supabaseAdmin
                  .from('users')
                  .select('email, name')
                  .eq('id', ws.created_by)
                  .single()
                if (owner?.email) {
                  sendNumberApprovedEmail(owner.email, owner.name, phone)
                }
              }
            } catch (e) {
              console.warn('[sync-campaign] Could not look up owner for approval email:', e.message)
            }
          }
        }
      } catch (err) {
        console.warn(`[sync-campaign-status] Failed to check ${phone}:`, err.message)
      }
    }

    return NextResponse.json({ success: true, synced, checked: numbers.length })
  } catch (error) {
    console.error('[sync-campaign-status] Error:', error)
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 })
  }
}
