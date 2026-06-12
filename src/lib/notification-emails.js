import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

const LOGO_URL = 'https://sebaeihdyfhbkqmmrjbh.supabase.co/storage/v1/object/public/assets/brand/logo.png'

const esc = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Shared branded shell — mirrors the onboarding OTP / mention emails.
// Plus Jakarta Sans / JetBrains Mono, #F7F6F3 bg, #D63B1F accent.
function brandedEmail({ kicker, heading, bodyHtml, ctaLabel, ctaLink, footnote }) {
  return `
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
            <img src="${LOGO_URL}" width="30" height="30" alt="AiroPhone" style="display:block;border-radius:7px;" />
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
        ${esc(kicker)}
      </div>

      <h1 style="margin:0 0 10px;font-size:24px;font-weight:600;color:#131210;letter-spacing:-0.03em;line-height:1.15;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        ${esc(heading)}
      </h1>

      ${bodyHtml}

      ${ctaLabel && ctaLink ? `
      <a href="${ctaLink}" style="display:inline-block;background:#D63B1F;color:#FFFFFF;text-decoration:none;font-size:14px;font-weight:500;padding:12px 22px;border-radius:10px;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        ${esc(ctaLabel)}
      </a>` : ''}

      <div style="height:1px;background:#E3E1DB;margin:28px 0 20px;"></div>

      <p style="margin:0;font-size:13px;font-weight:300;color:#9B9890;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
        ${esc(footnote)}
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
</html>`
}

// Email a teammate that a task was assigned to them. Best-effort: callers
// should wrap in try/catch — a mail failure must never block task creation.
export async function sendTaskAssignedEmail({
  to,
  recipientName,
  actorName,
  taskTitle,
  taskDescription,
  dueDate,
  conversationLabel,
  link,
}) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping task assignment email')
    return
  }
  if (!to) return

  const greeting = recipientName ? `Hi ${esc(recipientName.split(' ')[0])},` : 'Hi,'
  const due = dueDate
    ? new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const bodyHtml = `
    <p style="margin:0 0 24px;font-size:14px;font-weight:300;color:#5C5A55;line-height:1.65;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">
      ${greeting} ${esc(actorName)} assigned you a task${conversationLabel ? ` on the conversation with <strong style="font-weight:500;color:#131210;">${esc(conversationLabel)}</strong>` : ''}.
    </p>
    <div style="background:#EFEDE8;border:1px solid #E3E1DB;border-radius:12px;padding:18px 20px;margin-bottom:28px;">
      <p style="margin:0;font-size:15px;font-weight:600;color:#131210;line-height:1.4;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">${esc(taskTitle)}</p>
      ${taskDescription ? `<p style="margin:8px 0 0;font-size:13px;font-weight:300;color:#5C5A55;line-height:1.6;white-space:pre-wrap;font-family:'Plus Jakarta Sans','Helvetica Neue',Arial,sans-serif;">${esc(taskDescription)}</p>` : ''}
      ${due ? `<p style="margin:12px 0 0;font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:#9B9890;letter-spacing:0.04em;">DUE ${esc(due)}</p>` : ''}
    </div>`

  const html = brandedEmail({
    kicker: 'New task',
    heading: `${actorName} assigned you a task`,
    bodyHtml,
    ctaLabel: 'View task',
    ctaLink: link,
    footnote: "You're receiving this because a teammate assigned you a task in AiroPhone.",
  })

  await resend.emails.send({
    from: 'AiroPhone <noreply@airophone.com>',
    to,
    subject: `${actorName} assigned you a task: ${taskTitle}`,
    html,
  })
}
