import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET /api/ai-settings — returns workspace AI settings
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
      .from('workspace_ai_settings')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (error && error.code !== 'PGRST116') {
      throw error
    }

    return NextResponse.json({
      success: true,
      settings: data || {
        workspace_id: workspace.workspaceId,
        ai_reply_delay_min: 0,
        ai_reply_delay_max: 0
      }
    })
  } catch (error) {
    console.error('Error fetching AI settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/ai-settings — upsert workspace AI settings
export async function PUT(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { ai_reply_delay_min, ai_reply_delay_max } = await request.json()

    const min = Math.max(0, parseInt(ai_reply_delay_min) || 0)
    const max = Math.max(0, parseInt(ai_reply_delay_max) || 0)

    const { data, error } = await supabaseAdmin
      .from('workspace_ai_settings')
      .upsert({
        workspace_id: workspace.workspaceId,
        ai_reply_delay_min: min,
        ai_reply_delay_max: max,
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id' })
      .select()
      .single()

    if (error) {
      console.error('Error saving AI settings:', error)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    return NextResponse.json({ success: true, settings: data })
  } catch (error) {
    console.error('Error updating AI settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
