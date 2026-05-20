// CRUD for the 1:1 link between a campaign and a Monday board.
//   GET    /api/campaigns/[id]/monday-link  → current link or null
//   POST   /api/campaigns/[id]/monday-link  → upsert link from request body
//   DELETE /api/campaigns/[id]/monday-link  → remove link (campaign falls back to contact list)
//
// Workspace ownership is enforced by joining through campaigns.workspace_id —
// you can't link a campaign you don't own.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

async function loadCampaignOwned(campaignId, workspaceId) {
  const { data, error } = await supabaseAdmin
    .from('campaigns')
    .select('id, workspace_id, status')
    .eq('id', campaignId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: campaignId } = await params

  const campaign = await loadCampaignOwned(campaignId, user.workspaceId)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('campaign_monday_links')
    .select('board_id, board_name, group_ids, item_ids, phone_column_id, created_at, updated_at')
    .eq('campaign_id', campaignId)
    .maybeSingle()

  if (error) {
    console.error('[monday-link GET] db error:', error)
    return NextResponse.json({ error: 'Failed to load link' }, { status: 500 })
  }

  return NextResponse.json({ link: data || null })
}

export async function POST(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: campaignId } = await params

  const campaign = await loadCampaignOwned(campaignId, user.workspaceId)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Don't allow editing the link of an in-flight campaign — would silently
  // change who else receives messages while the send loop is running.
  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: 'Can only link a board to a draft campaign. Stop or duplicate it first.' },
      { status: 409 }
    )
  }

  const body = await request.json()
  const { board_id, board_name, group_ids, item_ids, phone_column_id } = body

  if (!board_id || !phone_column_id) {
    return NextResponse.json(
      { error: 'board_id and phone_column_id are required' },
      { status: 400 }
    )
  }

  // group_ids: null/undefined/empty array all mean "all groups". Normalize to null.
  const normalizedGroupIds =
    Array.isArray(group_ids) && group_ids.length > 0 ? group_ids.map(String) : null

  // item_ids: null/undefined/empty array all mean "all items in the selected
  // groups". Normalize to null so board rows added later are still included.
  const normalizedItemIds =
    Array.isArray(item_ids) && item_ids.length > 0 ? item_ids.map(String) : null

  const now = new Date().toISOString()
  const { error: upsertErr } = await supabaseAdmin
    .from('campaign_monday_links')
    .upsert(
      {
        campaign_id: campaignId,
        board_id: String(board_id),
        board_name: board_name || null,
        group_ids: normalizedGroupIds,
        item_ids: normalizedItemIds,
        phone_column_id: String(phone_column_id),
        updated_at: now,
      },
      { onConflict: 'campaign_id' }
    )

  if (upsertErr) {
    console.error('[monday-link POST] upsert error:', upsertErr)
    return NextResponse.json({ error: 'Failed to save link' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id: campaignId } = await params

  const campaign = await loadCampaignOwned(campaignId, user.workspaceId)
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: 'Can only unlink a draft campaign' },
      { status: 409 }
    )
  }

  const { error } = await supabaseAdmin
    .from('campaign_monday_links')
    .delete()
    .eq('campaign_id', campaignId)

  if (error) {
    console.error('[monday-link DELETE] db error:', error)
    return NextResponse.json({ error: 'Failed to unlink' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
