// app/api/campaigns/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch all campaigns
export async function GET(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    console.log('Fetching campaigns for workspace:', workspace.workspaceId)

    // Get campaigns filtered by workspace
    const { data: campaigns, error } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Database error fetching campaigns:', error)
      return NextResponse.json(
        { error: 'Failed to fetch campaigns', details: error.message },
        { status: 500 }
      )
    }

    console.log(`Retrieved ${campaigns?.length || 0} campaigns`)

    return NextResponse.json({
      success: true,
      campaigns: campaigns || []
    })

  } catch (error) {
    console.error('Error in campaigns GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new campaign
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const body = await request.json()

    console.log('Creating campaign:', body)

    const {
      name,
      message_template,
      sender_number,
      contact_list_ids,
      delay_between_messages
    } = body

    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Campaign name is required' },
        { status: 400 }
      )
    }

    if (!message_template?.trim()) {
      return NextResponse.json(
        { error: 'Message template is required' },
        { status: 400 }
      )
    }

    if (!sender_number?.trim()) {
      return NextResponse.json(
        { error: 'Sender phone number is required' },
        { status: 400 }
      )
    }

    if (!contact_list_ids || contact_list_ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one contact list must be selected' },
        { status: 400 }
      )
    }

    // Get total recipients count from selected contact lists (workspace-filtered)
    const { data: contacts, error: contactsError } = await supabaseAdmin
      .from('contacts')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspace.workspaceId)
      .in('contact_list_id', contact_list_ids)

    if (contactsError) {
      console.error('Error counting contacts:', contactsError)
      return NextResponse.json(
        { error: 'Failed to count recipients', details: contactsError.message },
        { status: 500 }
      )
    }

    const totalRecipients = contacts?.length || 0

    if (totalRecipients === 0) {
      return NextResponse.json(
        { error: 'Selected contact lists have no contacts' },
        { status: 400 }
      )
    }

    // Create campaign
    const campaignData = {
      name: name.trim(),
      message_template: message_template.trim(),
      sender_number: sender_number.trim(),
      contact_list_ids: contact_list_ids,
      delay_between_messages: delay_between_messages || 1000,
      workspace_id: workspace.workspaceId,
      status: 'draft',
      total_recipients: totalRecipients,
      sent_count: 0,
      failed_count: 0,
      created_by: user.userId
    }

    const { data: campaign, error: campaignError } = await supabaseAdmin
      .from('campaigns')
      .insert(campaignData)
      .select()
      .single()

    if (campaignError) {
      console.error('Database error creating campaign:', campaignError)
      return NextResponse.json(
        { error: 'Failed to create campaign', details: campaignError.message },
        { status: 500 }
      )
    }

    console.log('Campaign created successfully:', campaign.id)

    return NextResponse.json({
      success: true,
      campaign: campaign
    })

  } catch (error) {
    console.error('Error in campaigns POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// PUT - Update campaign
export async function PUT(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('id')
    const body = await request.json()

    if (!campaignId) {
      return NextResponse.json(
        { error: 'Campaign ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating campaign:', campaignId, body)

    // Get existing campaign (workspace-filtered)
    const { data: existingCampaign, error: fetchError } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (fetchError || !existingCampaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    // Only allow updating draft campaigns
    if (existingCampaign.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft campaigns can be edited' },
        { status: 400 }
      )
    }

    const { 
      name, 
      message_template, 
      sender_number, 
      contact_list_ids, 
      delay_between_messages 
    } = body

    const updateData = {}
    if (name !== undefined) updateData.name = name.trim()
    if (message_template !== undefined) updateData.message_template = message_template.trim()
    if (sender_number !== undefined) updateData.sender_number = sender_number.trim()
    if (delay_between_messages !== undefined) updateData.delay_between_messages = delay_between_messages

    // If contact lists changed, recalculate total recipients (workspace-filtered)
    if (contact_list_ids !== undefined) {
      updateData.contact_list_ids = contact_list_ids

      const { data: contacts, error: contactsError } = await supabaseAdmin
        .from('contacts')
        .select('id', { count: 'exact' })
        .eq('workspace_id', workspace.workspaceId)
        .in('contact_list_id', contact_list_ids)

      if (!contactsError) {
        updateData.total_recipients = contacts?.length || 0
      }
    }

    const { data: updatedCampaign, error: updateError } = await supabaseAdmin
      .from('campaigns')
      .update(updateData)
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .select()
      .single()

    if (updateError) {
      console.error('Database error updating campaign:', updateError)
      return NextResponse.json(
        { error: 'Failed to update campaign', details: updateError.message },
        { status: 500 }
      )
    }

    console.log('Campaign updated successfully:', campaignId)

    return NextResponse.json({
      success: true,
      campaign: updatedCampaign
    })

  } catch (error) {
    console.error('Error in campaigns PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// DELETE - Delete campaign
export async function DELETE(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const campaignId = searchParams.get('id')

    if (!campaignId) {
      return NextResponse.json(
        { error: 'Campaign ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting campaign:', campaignId)

    // Get campaign to check status (workspace-filtered)
    const { data: campaign, error: fetchError } = await supabaseAdmin
      .from('campaigns')
      .select('status')
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (fetchError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }

    // Don't allow deleting running campaigns
    if (campaign.status === 'running') {
      return NextResponse.json(
        { error: 'Cannot delete a running campaign. Please stop it first.' },
        { status: 400 }
      )
    }

    // Delete campaign_messages first (foreign key constraint)
    const { error: messagesDeleteError } = await supabaseAdmin
      .from('campaign_messages')
      .delete()
      .eq('campaign_id', campaignId)

    if (messagesDeleteError) {
      console.error('Error deleting campaign messages:', messagesDeleteError)
      // Continue anyway, might not have any messages
    }

    // Delete the campaign
    const { error: deleteError } = await supabaseAdmin
      .from('campaigns')
      .delete()
      .eq('id', campaignId)
      .eq('workspace_id', workspace.workspaceId)

    if (deleteError) {
      console.error('Database error deleting campaign:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete campaign', details: deleteError.message },
        { status: 500 }
      )
    }

    console.log('Campaign deleted successfully:', campaignId)

    return NextResponse.json({
      success: true,
      message: 'Campaign deleted successfully'
    })

  } catch (error) {
    console.error('Error in campaigns DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}