// CRUD for the 1:1 link between a campaign and a Google Sheet tab — the
// Sheets sibling of the monday-link route.
//   GET    /api/campaigns/[id]/sheets-link  → current link or null
//   POST   /api/campaigns/[id]/sheets-link  → upsert link from request body
//   DELETE /api/campaigns/[id]/sheets-link  → remove link (falls back to contact lists)

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
    .from('campaign_sheets_links')
    .select('spreadsheet_id, spreadsheet_name, sheet_id, sheet_name, phone_column, row_ids, created_at, updated_at')
    .eq('campaign_id', campaignId)
    .maybeSingle()

  if (error) {
    console.error('[sheets-link GET] db error:', error)
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

  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: 'Can only link a sheet to a draft campaign. Stop or duplicate it first.' },
      { status: 409 }
    )
  }

  const body = await request.json()
  const { spreadsheet_id, spreadsheet_name, sheet_id, sheet_name, phone_column, row_ids } = body

  if (!spreadsheet_id || !sheet_name || !phone_column) {
    return NextResponse.json(
      { error: 'spreadsheet_id, sheet_name and phone_column are required' },
      { status: 400 }
    )
  }

  // row_ids: null/undefined/empty array all mean "all rows". Normalize to null
  // so rows added to the sheet later are still included.
  const normalizedRowIds =
    Array.isArray(row_ids) && row_ids.length > 0 ? row_ids.map(String) : null

  const now = new Date().toISOString()
  const { error: upsertErr } = await supabaseAdmin
    .from('campaign_sheets_links')
    .upsert(
      {
        campaign_id: campaignId,
        spreadsheet_id: String(spreadsheet_id),
        spreadsheet_name: spreadsheet_name || null,
        sheet_id: sheet_id != null ? Number(sheet_id) : null,
        sheet_name: String(sheet_name),
        phone_column: String(phone_column),
        row_ids: normalizedRowIds,
        updated_at: now,
      },
      { onConflict: 'campaign_id' }
    )

  if (upsertErr) {
    console.error('[sheets-link POST] upsert error:', upsertErr)
    return NextResponse.json({ error: 'Failed to save link' }, { status: 500 })
  }

  // A campaign has exactly one source — linking a sheet supersedes any Monday link.
  await supabaseAdmin.from('campaign_monday_links').delete().eq('campaign_id', campaignId)

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
    .from('campaign_sheets_links')
    .delete()
    .eq('campaign_id', campaignId)

  if (error) {
    console.error('[sheets-link DELETE] db error:', error)
    return NextResponse.json({ error: 'Failed to unlink' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
