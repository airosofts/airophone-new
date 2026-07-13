// Sandbox test chats for a scenario ("Test your AI").
//   GET    /api/scenarios/[id]/sandbox                 → list test chats
//   POST   /api/scenarios/[id]/sandbox { name? }       → create a test chat
//   DELETE /api/scenarios/[id]/sandbox?session_id=…    → delete a test chat

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

async function loadScenarioOwned(scenarioId, workspaceId) {
  const { data } = await supabaseAdmin
    .from('scenarios')
    .select('id, workspace_id, name, ai_model')
    .eq('id', scenarioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return data
}

export async function GET(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: scenarioId } = await params

  const scenario = await loadScenarioOwned(scenarioId, user.workspaceId)
  if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

  const { data: sessions, error } = await supabaseAdmin
    .from('scenario_sandbox_sessions')
    .select('id, name, created_at, updated_at, scenario_sandbox_messages(id, body, direction, created_at)')
    .eq('scenario_id', scenarioId)
    .order('updated_at', { ascending: false })
    .order('created_at', { referencedTable: 'scenario_sandbox_messages', ascending: false })
    .limit(1, { referencedTable: 'scenario_sandbox_messages' })

  if (error) {
    console.error('[sandbox GET] db error:', error)
    return NextResponse.json({ error: 'Failed to load test chats' }, { status: 500 })
  }

  return NextResponse.json({
    scenario: { id: scenario.id, name: scenario.name, ai_model: scenario.ai_model || null },
    sessions: (sessions || []).map(s => ({
      id: s.id,
      name: s.name,
      created_at: s.created_at,
      updated_at: s.updated_at,
      lastMessage: s.scenario_sandbox_messages?.[0] || null,
    })),
  })
}

export async function POST(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: scenarioId } = await params

  const scenario = await loadScenarioOwned(scenarioId, user.workspaceId)
  if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const name = (body.name || '').trim() ||
    `Test chat — ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date())}`

  const { data, error } = await supabaseAdmin
    .from('scenario_sandbox_sessions')
    .insert({
      scenario_id: scenarioId,
      workspace_id: user.workspaceId,
      name,
      created_by: user.userId || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[sandbox POST] db error:', error)
    return NextResponse.json({ error: 'Failed to create test chat' }, { status: 500 })
  }
  return NextResponse.json({ success: true, session: data })
}

export async function DELETE(request, { params }) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: scenarioId } = await params

  const sessionId = new URL(request.url).searchParams.get('session_id')
  if (!sessionId) return NextResponse.json({ error: 'session_id is required' }, { status: 400 })

  const scenario = await loadScenarioOwned(scenarioId, user.workspaceId)
  if (!scenario) return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })

  const { error } = await supabaseAdmin
    .from('scenario_sandbox_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('scenario_id', scenarioId)
    .eq('workspace_id', user.workspaceId)

  if (error) {
    console.error('[sandbox DELETE] db error:', error)
    return NextResponse.json({ error: 'Failed to delete test chat' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
