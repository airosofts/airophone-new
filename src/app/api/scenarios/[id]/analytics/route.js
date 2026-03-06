import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch analytics for a scenario
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
    const days = parseInt(searchParams.get('days') || '30')

    // Verify scenario belongs to user's workspace
    const { data: scenario } = await supabaseAdmin
      .from('scenarios')
      .select('id, name')
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (!scenario) {
      return NextResponse.json(
        { error: 'Scenario not found' },
        { status: 404 }
      )
    }

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    // Get follow-up state statistics
    const { data: followupStats } = await supabaseAdmin
      .from('conversation_followup_state')
      .select('stopped, total_attempts, current_stage, created_at')
      .eq('scenario_id', id)
      .gte('created_at', startDate.toISOString())

    // Get message statistics
    const { data: messageStats } = await supabaseAdmin
      .from('scenario_executions')
      .select('execution_status, tokens_used, processing_time_ms, created_at')
      .eq('scenario_id', id)
      .gte('created_at', startDate.toISOString())

    // Get conversations with manual override
    const { count: manualOverrideCount } = await supabaseAdmin
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('manual_override', true)
      .in('id', (followupStats || []).map(f => f.conversation_id))

    // Calculate metrics
    const totalConversations = followupStats?.length || 0
    const stoppedCount = followupStats?.filter(f => f.stopped).length || 0
    const activeConversations = totalConversations - stoppedCount

    const totalMessages = messageStats?.length || 0
    const successfulMessages = messageStats?.filter(m => m.execution_status === 'success').length || 0
    const failedMessages = messageStats?.filter(m => m.execution_status === 'failed').length || 0

    const totalTokens = messageStats?.reduce((sum, m) => sum + (m.tokens_used || 0), 0) || 0
    const avgTokensPerMessage = totalMessages > 0 ? Math.round(totalTokens / totalMessages) : 0

    const avgProcessingTime = messageStats?.length > 0
      ? Math.round(messageStats.reduce((sum, m) => sum + (m.processing_time_ms || 0), 0) / messageStats.length)
      : 0

    const avgMessagesPerConversation = totalConversations > 0
      ? (totalMessages / totalConversations).toFixed(2)
      : 0

    // Get follow-up stage distribution
    const stageDistribution = {}
    followupStats?.forEach(f => {
      const stage = f.current_stage || 0
      stageDistribution[stage] = (stageDistribution[stage] || 0) + 1
    })

    // Calculate estimated cost (rough estimate: $0.0001 per token for GPT-4o-mini)
    const estimatedCost = (totalTokens * 0.0001).toFixed(4)

    // Response rate (conversations that progressed beyond stage 0)
    const respondedConversations = followupStats?.filter(f => f.total_attempts > 0).length || 0
    const responseRate = totalConversations > 0
      ? ((respondedConversations / totalConversations) * 100).toFixed(1)
      : 0

    return NextResponse.json({
      success: true,
      analytics: {
        scenario: {
          id: scenario.id,
          name: scenario.name
        },
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          days
        },
        conversations: {
          total: totalConversations,
          active: activeConversations,
          stopped: stoppedCount,
          manualOverride: manualOverrideCount || 0,
          responseRate: `${responseRate}%`
        },
        messages: {
          total: totalMessages,
          successful: successfulMessages,
          failed: failedMessages,
          successRate: totalMessages > 0 ? `${((successfulMessages / totalMessages) * 100).toFixed(1)}%` : '0%',
          avgPerConversation: avgMessagesPerConversation
        },
        performance: {
          totalTokens,
          avgTokensPerMessage,
          avgProcessingTimeMs: avgProcessingTime,
          estimatedCost: `$${estimatedCost}`
        },
        followupStages: stageDistribution
      }
    })

  } catch (error) {
    console.error('Error fetching scenario analytics:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
