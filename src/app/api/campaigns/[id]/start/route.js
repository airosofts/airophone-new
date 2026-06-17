//app/api/campaigns/[id]/start/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import telnyx from '@/lib/telnyx'
import { normalizePhoneNumber } from '@/lib/phone-utils'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { getWorkspaceMessageRate, calculateMessageCost } from '@/lib/pricing'
import { listAllItems, extractPhone, columnTitleToPlaceholder, listColumns } from '@/lib/monday'
import { fetchAllContacts } from '@/lib/contacts-fetch'

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

    // ── Load recipients from either Monday or the contacts table ───────────
    // If a campaign_monday_links row exists, source items from Monday and
    // ignore contact_list_ids entirely. Otherwise fall back to the existing
    // contacts path. Either way we end up with a unified `recipients` array.
    const { data: mondayLink } = await supabaseAdmin
      .from('campaign_monday_links')
      .select('board_id, group_ids, item_ids, phone_column_id')
      .eq('campaign_id', campaignId)
      .maybeSingle()

    let recipients = []   // [{ key: {contact_id|monday_item_id}, phone, vars, displayName }]
    const seenPhones = new Set()

    if (mondayLink) {
      let items, columns
      try {
        columns = await listColumns(workspace.workspaceId, mondayLink.board_id)
        items = await listAllItems(workspace.workspaceId, mondayLink.board_id, {
          groupIds: mondayLink.group_ids,
        })
      } catch (err) {
        console.error('[campaign/start] Monday fetch failed:', err.message)
        return NextResponse.json(
          { error: 'Failed to fetch Monday items. Reconnect Monday or check the board still exists.' },
          { status: 502 }
        )
      }

      // Pre-compute column id → placeholder slug map for fast lookup
      const colSlugById = new Map(columns.map(c => [c.id, columnTitleToPlaceholder(c.title)]))

      // item_ids null/empty == "all items"; otherwise restrict to the picked rows.
      const allowedItemIds =
        Array.isArray(mondayLink.item_ids) && mondayLink.item_ids.length > 0
          ? new Set(mondayLink.item_ids.map(String))
          : null

      for (const item of items) {
        if (allowedItemIds && !allowedItemIds.has(String(item.id))) continue
        const phoneCv = item.column_values.find(cv => cv.id === mondayLink.phone_column_id)
        const rawPhone = extractPhone(phoneCv)
        const normalized = normalizePhoneNumber(rawPhone)
        if (!normalized || seenPhones.has(normalized)) continue
        seenPhones.add(normalized)

        const vars = { name: item.name || '' }
        for (const cv of item.column_values) {
          const slug = colSlugById.get(cv.id)
          if (slug) vars[slug] = cv.text || ''
        }

        recipients.push({
          key: { monday_item_id: String(item.id) },
          phone: normalized,
          vars,
          displayName: item.name || null,
        })
      }
    } else {
      // Get ALL contacts from selected lists — page past PostgREST's 1000-row
      // cap so a 15k list isn't silently truncated to 1,000 recipients.
      let rawContacts = []
      try {
        rawContacts = await fetchAllContacts({
          workspaceId: workspace.workspaceId,
          contactListIds: campaign.contact_list_ids,
          columns: '*',
        })
      } catch (contactsError) {
        console.error('Error fetching contacts:', contactsError)
        return NextResponse.json(
          { error: 'Failed to fetch contacts' },
          { status: 500 }
        )
      }

      for (const c of (rawContacts || [])) {
        const normalized = normalizePhoneNumber(c.phone_number)
        if (!normalized || seenPhones.has(normalized)) continue
        seenPhones.add(normalized)
        recipients.push({
          key: { contact_id: c.id },
          phone: normalized,
          vars: {
            first_name: c.first_name || '',
            last_name: c.last_name || '',
            business_name: c.business_name || '',
            phone: c.phone_number || '',
            email: c.email || '',
            city: c.city || '',
            state: c.state || '',
            country: c.country || '',
          },
          displayName: c.business_name || null,
        })
      }
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

function hydrateTemplate(template, vars) {
  if (!template) return ''
  // Support both legacy single-brace {first_name} (contacts path) and
  // double-brace {{first_name}} (Monday path). Unknown keys become empty string.
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''))
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''))
}
