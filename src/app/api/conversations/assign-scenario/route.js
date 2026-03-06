import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// POST /api/conversations/assign-scenario
// Body: { conversationId, scenarioId } — scenarioId null to remove assignment
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { conversationId, scenarioId } = await request.json()

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }

    // Get conversation to find the contact's phone number
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('phone_number')
      .eq('id', conversationId)
      .single()

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const contactPhone = conversation.phone_number

    // Get all scenario IDs for this workspace to scope the cleanup
    const { data: workspaceScenarios } = await supabaseAdmin
      .from('scenarios')
      .select('id')
      .eq('workspace_id', workspace.workspaceId)

    const workspaceScenarioIds = (workspaceScenarios || []).map(s => s.id)

    // Remove this contact from all workspace scenarios
    if (workspaceScenarioIds.length > 0) {
      await supabaseAdmin
        .from('scenario_contacts')
        .delete()
        .eq('recipient_phone', contactPhone)
        .in('scenario_id', workspaceScenarioIds)
    }

    // If a specific scenario was chosen, add contact to it
    if (scenarioId) {
      // Verify the scenario belongs to this workspace
      const { data: scenario } = await supabaseAdmin
        .from('scenarios')
        .select('id')
        .eq('id', scenarioId)
        .eq('workspace_id', workspace.workspaceId)
        .single()

      if (!scenario) {
        return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
      }

      const { error: insertError } = await supabaseAdmin
        .from('scenario_contacts')
        .insert({
          scenario_id: scenarioId,
          recipient_phone: contactPhone,
          contact_id: null
        })

      if (insertError) {
        console.error('Error assigning scenario:', insertError)
        return NextResponse.json({ error: 'Failed to assign scenario' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      assigned: scenarioId ? scenarioId : null,
      contactPhone
    })

  } catch (error) {
    console.error('Error in assign-scenario:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/conversations/assign-scenario?conversationId=xxx
// Returns current scenario assignment for a conversation
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const conversationId = searchParams.get('conversationId')

    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }

    const { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('phone_number')
      .eq('id', conversationId)
      .single()

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    // Find if this contact is explicitly assigned to a scenario in this workspace
    const { data: assignment } = await supabaseAdmin
      .from('scenario_contacts')
      .select(`
        scenario_id,
        scenarios!inner (
          id,
          name,
          is_active,
          workspace_id
        )
      `)
      .eq('recipient_phone', conversation.phone_number)
      .eq('scenarios.workspace_id', workspace.workspaceId)
      .single()

    return NextResponse.json({
      success: true,
      assignedScenario: assignment ? {
        id: assignment.scenarios.id,
        name: assignment.scenarios.name,
        is_active: assignment.scenarios.is_active
      } : null
    })

  } catch (error) {
    console.error('Error getting scenario assignment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
