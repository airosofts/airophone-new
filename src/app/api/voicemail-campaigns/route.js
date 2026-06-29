// List + create voicemail campaigns for the current workspace.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { normalizeVoicemailCampaignInput, buildQueueRows } from '@/lib/voicemail-campaign-input'

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('*')
    .eq('workspace_id', workspace.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[voicemail-campaigns:GET]', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaigns: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))

  const norm = normalizeVoicemailCampaignInput(body)
  if (norm.error) {
    return NextResponse.json({ error: norm.error }, { status: 400 })
  }

  // Sender number must belong to this workspace AND be voicedrop_verified
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

  const { data: campaign, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .insert({
      workspace_id: workspace.workspaceId,
      created_by: user.userId,
      ...norm.columns,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('[voicemail-campaigns:POST]', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }

  // If the wizard supplied an explicit recipient list (after the user picked
  // a chunk + searched + unticked rows), pre-populate the queue here. The
  // /start route will then see existing rows and skip the contact-list rebuild.
  if (norm.explicitRecipients.length > 0) {
    const queueRows = buildQueueRows(norm.explicitRecipients, campaign.id, workspace.workspaceId)
    // Insert in 1000-row batches (a 15k-row upsert can exceed request limits).
    for (let i = 0; i < queueRows.length; i += 1000) {
      const { error: enqErr } = await supabaseAdmin
        .from('voicemail_campaign_sends')
        .upsert(queueRows.slice(i, i + 1000), { onConflict: 'campaign_id,phone', ignoreDuplicates: true })
      if (enqErr) {
        console.error('[voicemail-campaigns:POST] explicit enqueue failed:', enqErr)
        // Don't fail the create — /start can still fall back to the list rebuild.
        break
      }
    }
  }

  return NextResponse.json({ success: true, campaign })
}
