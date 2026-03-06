import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch all follow-up stages for a scenario
export async function GET(request, { params }) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params

    // Verify scenario belongs to user's workspace
    const { data: scenario } = await supabaseAdmin
      .from('scenarios')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (!scenario) {
      return NextResponse.json(
        { error: 'Scenario not found' },
        { status: 404 }
      )
    }

    const { data: stages, error } = await supabaseAdmin
      .from('scenario_followup_stages')
      .select('*')
      .eq('scenario_id', id)
      .order('stage_number', { ascending: true })

    if (error) {
      console.error('Error fetching follow-up stages:', error)
      return NextResponse.json(
        { error: 'Failed to fetch follow-up stages' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      stages: stages || []
    })

  } catch (error) {
    console.error('Error in GET followup-stages:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create or update follow-up stages
export async function POST(request, { params }) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const { stages } = body

    if (!Array.isArray(stages)) {
      return NextResponse.json(
        { error: 'stages must be an array' },
        { status: 400 }
      )
    }

    // Verify scenario belongs to user's workspace
    const { data: scenario } = await supabaseAdmin
      .from('scenarios')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (!scenario) {
      return NextResponse.json(
        { error: 'Scenario not found' },
        { status: 404 }
      )
    }

    // Delete existing stages
    await supabaseAdmin
      .from('scenario_followup_stages')
      .delete()
      .eq('scenario_id', id)

    // Insert new stages
    if (stages.length > 0) {
      const stageInserts = stages.map((stage, index) => ({
        scenario_id: id,
        stage_number: stage.stage_number || index + 1,
        wait_duration: stage.wait_duration,
        wait_unit: stage.wait_unit || 'minutes',
        instructions: stage.instructions
      }))

      const { error: insertError } = await supabaseAdmin
        .from('scenario_followup_stages')
        .insert(stageInserts)

      if (insertError) {
        console.error('Error inserting follow-up stages:', insertError)
        return NextResponse.json(
          { error: 'Failed to create follow-up stages' },
          { status: 500 }
        )
      }
    }

    // Get updated stages
    const { data: updatedStages } = await supabaseAdmin
      .from('scenario_followup_stages')
      .select('*')
      .eq('scenario_id', id)
      .order('stage_number', { ascending: true })

    return NextResponse.json({
      success: true,
      stages: updatedStages || []
    })

  } catch (error) {
    console.error('Error in POST followup-stages:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
