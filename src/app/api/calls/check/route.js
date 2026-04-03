// GET /api/calls/check - Debug call records
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = createSupabaseServerClient()

  // Get recent calls with conversation info
  const { data: calls, error } = await supabase
    .from('calls')
    .select('id, telnyx_call_id, from_number, to_number, direction, status, duration_seconds, conversation_id, answered_at, ended_at, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  // Check if conversation_id column exists by trying to query it
  const { data: colCheck, error: colError } = await supabase
    .rpc('to_jsonb', { val: 'test' })
    .select()
    .limit(0)

  // Get column info
  const { data: columns } = await supabase
    .from('calls')
    .select('conversation_id')
    .limit(1)

  return NextResponse.json({
    recentCalls: calls || [],
    callsError: error?.message,
    columnTest: colError?.message,
    hasConversationId: !error && calls?.[0] ? 'conversation_id' in (calls[0] || {}) : 'unknown'
  })
}
