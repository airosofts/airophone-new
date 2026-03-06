import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch scenario execution logs
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
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Verify scenario belongs to workspace
    const { data: scenario, error: scenarioError } = await supabaseAdmin
      .from('scenarios')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (scenarioError || !scenario) {
      return NextResponse.json(
        { error: 'Scenario not found' },
        { status: 404 }
      )
    }

    const { data: executions, error, count } = await supabaseAdmin
      .from('scenario_executions')
      .select('*', { count: 'exact' })
      .eq('scenario_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Error fetching scenario executions:', error)
      return NextResponse.json(
        { error: 'Failed to fetch executions' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      executions,
      total: count
    })
  } catch (error) {
    console.error('Error in scenario executions GET:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
