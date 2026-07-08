//app/api/campaigns/[id]/start/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { getWorkspaceMessageRate, calculateMessageCost } from '@/lib/pricing'
import { resolveCampaignRecipients, hydrateTemplate } from '@/lib/campaign-recipients'

export async function POST(request, { params }) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { id: campaignId } = await params

    // Get campaign details (workspace-filtered)
    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    if (campaign.status !== 'draft') {
      return NextResponse.json(
        { error: 'Campaign is not in draft status' },
        { status: 400 }
      )
    }

    // Block trial accounts from sending campaigns
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (sub?.status === 'trialing') {
      return NextResponse.json(
        {
          error: 'trial_restriction',
          message: 'Campaign sending requires an active paid subscription. End your trial to start sending now.',
        },
        { status: 402 }
      )
    }

    // ── Load recipients from Monday, Google Sheets, or the contacts table ──
    // resolveCampaignRecipients checks campaign_monday_links first, then
    // campaign_sheets_links, then falls back to contact_list_ids — the same
    // resolution the recurring re-enqueue uses.
    let recipients = []   // [{ key: {contact_id|monday_item_id|sheet_row_id}, phone, vars, displayName }]
    try {
      recipients = await resolveCampaignRecipients(campaign, workspace.workspaceId)
    } catch (err) {
      console.error('[campaign/start] recipient resolution failed:', err.message)
      return NextResponse.json(
        { error: 'Failed to fetch recipients from the campaign source. Check the integration is still connected and the board/sheet exists.' },
        { status: 502 }
      )
    }

    // Kept for downstream code that reads `contacts.length` (cost check uses it).
    const contacts = recipients

    // Get current message rate for this workspace based on tiered pricing
    const messageCount = contacts.length
    const messageRate = await getWorkspaceMessageRate(workspace.workspaceId)

    // Check if user can afford the message costs (actual wallet balance)
    const { data: affordCheck, error: affordError } = await supabaseAdmin.rpc(
      'can_afford_message_cost_v2',
      {
        p_user_id: user.userId,
        p_message_count: messageCount,
        p_cost_per_message: messageRate
      }
    )

    if (affordError) {
      console.error('Error checking wallet balance:', affordError)
      return NextResponse.json(
        { error: 'Failed to verify balance' },
        { status: 500 }
      )
    }

    if (!affordCheck?.can_afford) {
      return NextResponse.json(
        {
          error: 'Insufficient credits',
          message: `Insufficient credits. Current credits: ${Math.floor(affordCheck?.current_balance || 0)}, Required: ${Math.floor(affordCheck?.required_amount || 0)} credits for ${messageCount} messages. Please top up your wallet to continue.`,
          details: {
            currentBalance: affordCheck?.current_balance || 0,
            requiredAmount: affordCheck?.required_amount || 0,
            shortage: affordCheck?.shortage || 0,
            messageCount
          }
        },
        { status: 402 }
      )
    }

    // Atomically claim the campaign (draft → 'enqueuing') so a double-click can't
    // spawn two enqueues. The cron ignores 'enqueuing', so it won't sweep this
    // campaign until we flip it to its final status below.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('campaigns')
      .update({ status: 'enqueuing', total_recipients: messageCount })
      .eq('id', campaignId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle()

    if (claimError) {
      console.error('Error claiming campaign:', claimError)
      return NextResponse.json({ error: 'Failed to start campaign' }, { status: 500 })
    }
    if (!claimed) {
      return NextResponse.json({ error: 'Campaign is already running or has finished' }, { status: 409 })
    }

    // Enqueue every recipient as a queued campaign_messages row with the phone +
    // pre-personalized body, so the cron sweeper sends without re-resolving
    // contacts/Monday. UNIQUE(campaign_id, contact_id|monday_item_id) dedupes.
    const queueRows = contacts.map(r => ({
      campaign_id: campaign.id,
      contact_id: r.key.contact_id || null,
      monday_item_id: r.key.monday_item_id || null,
      sheet_row_id: r.key.sheet_row_id || null,
      to_number: r.phone,
      body: hydrateTemplate(campaign.message_template, r.vars),
      status: 'queued',
    }))
    for (let i = 0; i < queueRows.length; i += 500) {
      const { error: insErr } = await supabaseAdmin
        .from('campaign_messages')
        .insert(queueRows.slice(i, i + 500))
      if (insErr && insErr.code !== '23505') {
        console.error('[campaign/start] enqueue error:', insErr)
      }
    }

    // Always 'running' — the sweeper holds sending until scheduled_at and inside
    // the send windows / throttle / daily cap. So a future scheduled_at simply
    // means nothing dispatches until its time (and within business hours).
    const isFuture = campaign.scheduled_at && new Date(campaign.scheduled_at).getTime() > Date.now()
    await supabaseAdmin
      .from('campaigns')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', campaign.id)

    return NextResponse.json({
      success: true,
      message: isFuture ? 'Campaign scheduled — sending begins at the chosen time' : 'Campaign queued — sending starts within a minute',
      scheduled: !!isFuture,
      scheduledAt: campaign.scheduled_at || null,
      estimatedCost: (messageCount * messageRate).toFixed(2),
      messageRate,
    })

  } catch (error) {
    console.error('Error starting campaign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
