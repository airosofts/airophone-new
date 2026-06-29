// PUT /api/voicemail-campaigns/[id] — edit a DRAFT voicemail campaign.
//
// Drafts are the only editable state (a running/completed campaign is immutable).
// Accepts the same wizard payload as create, updates the row, and re-enqueues the
// recipients (delete + reinsert) so a changed audience / column selection is
// reflected exactly. Launching afterward is the unchanged /start flow.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { normalizeVoicemailCampaignInput, buildQueueRows } from '@/lib/voicemail-campaign-input'

export async function PUT(request, { params }) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: campaignId } = await params

  // Must exist, belong to this workspace, and still be a draft.
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('id, status')
    .eq('id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }
  if (existing.status !== 'draft') {
    return NextResponse.json({ error: 'Only draft campaigns can be edited' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const norm = normalizeVoicemailCampaignInput(body)
  if (norm.error) {
    return NextResponse.json({ error: norm.error }, { status: 400 })
  }

  // Sender number must belong to this workspace AND be voicedrop_verified.
  const { data: pn } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, voicedrop_verified')
    .eq('phone_number', norm.columns.sender_number)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()
  if (!pn) {
    return NextResponse.json({ error: 'Sender number not found in this workspace' }, { status: 400 })
  }
  if (!pn.voicedrop_verified) {
    return NextResponse.json({ error: 'Sender number is not yet verified for voicemail' }, { status: 400 })
  }

  // Update the draft (re-asserting status='draft' guards against a concurrent launch).
  const { data: campaign, error: updErr } = await supabaseAdmin
    .from('voicemail_campaigns')
    .update(norm.columns)
    .eq('id', campaignId)
    .eq('workspace_id', workspace.workspaceId)
    .eq('status', 'draft')
    .select()
    .single()

  if (updErr || !campaign) {
    console.error('[voicemail-campaigns:PUT]', updErr)
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  }

  // Re-enqueue recipients: wipe the old queued set and lay down the new one, so
  // the audience matches exactly what the wizard now shows. Only safe because
  // the campaign is a draft (nothing has been sent yet).
  await supabaseAdmin.from('voicemail_campaign_sends').delete().eq('campaign_id', campaignId)

  if (norm.explicitRecipients.length > 0) {
    const queueRows = buildQueueRows(norm.explicitRecipients, campaignId, workspace.workspaceId)
    for (let i = 0; i < queueRows.length; i += 1000) {
      const { error: enqErr } = await supabaseAdmin
        .from('voicemail_campaign_sends')
        .upsert(queueRows.slice(i, i + 1000), { onConflict: 'campaign_id,phone', ignoreDuplicates: true })
      if (enqErr) {
        console.error('[voicemail-campaigns:PUT] enqueue failed:', enqErr)
        break
      }
    }
  }

  // Refresh the cached recipient total the list/UI reads.
  const { count } = await supabaseAdmin
    .from('voicemail_campaign_sends')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
  await supabaseAdmin.from('voicemail_campaigns')
    .update({ total_recipients: count || 0 })
    .eq('id', campaignId)

  return NextResponse.json({ success: true, campaign: { ...campaign, total_recipients: count || 0 } })
}
