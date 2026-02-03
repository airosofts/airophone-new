//app/api/campaigns/[id]/stop/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function POST(request, { params }) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    // Await params to fix Next.js 15 async API issue
    const resolvedParams = await params
    const campaignId = resolvedParams.id

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

    if (campaign.status !== 'running') {
      return NextResponse.json(
        { error: 'Campaign is not currently running' },
        { status: 400 }
      )
    }

    // Update campaign status to paused
    const { error: updateError } = await supabaseAdmin
      .from('campaigns')
      .update({
        status: 'paused',
        completed_at: new Date().toISOString()
      })
      .eq('id', campaignId)

    if (updateError) {
      console.error('Error stopping campaign:', updateError)
      return NextResponse.json(
        { error: 'Failed to stop campaign' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Campaign stopped successfully'
    })

  } catch (error) {
    console.error('Error stopping campaign:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}