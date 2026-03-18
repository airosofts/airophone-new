import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

// GET /api/call-forwarding/debug - Check forwarding setup status
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createSupabaseServerClient()
    const checks = {}

    // 1. Check if calls table exists by trying a count
    const { count: callsCount, error: callsError } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true })

    checks.calls_table = callsError
      ? { status: 'ERROR', message: callsError.message, hint: callsError.hint }
      : { status: 'OK', total_rows: callsCount }

    // 2. Check if call_forwarding_rules table exists
    const { count: rulesCount, error: rulesError } = await supabase
      .from('call_forwarding_rules')
      .select('*', { count: 'exact', head: true })

    checks.forwarding_rules_table = rulesError
      ? { status: 'ERROR', message: rulesError.message, hint: rulesError.hint }
      : { status: 'OK', total_rows: rulesCount }

    // 3. Get active forwarding rules for this workspace
    const { data: activeRules, error: activeError } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number, custom_name)')
      .eq('workspace_id', user.workspaceId)
      .eq('is_active', true)

    checks.active_rules = activeError
      ? { status: 'ERROR', message: activeError.message }
      : {
          status: 'OK',
          count: activeRules?.length || 0,
          rules: activeRules?.map(r => ({
            id: r.id,
            phone_number_id: r.phone_number_id,
            phone_number: r.phone_numbers?.phone_number,
            custom_name: r.phone_numbers?.custom_name,
            forward_to: r.forward_to,
            is_active: r.is_active
          }))
        }

    // 4. Get workspace phone numbers
    const { data: phoneNumbers, error: phoneError } = await supabase
      .from('phone_numbers')
      .select('id, phone_number, custom_name, workspace_id, is_active')
      .eq('workspace_id', user.workspaceId)

    checks.phone_numbers = phoneError
      ? { status: 'ERROR', message: phoneError.message }
      : { status: 'OK', count: phoneNumbers?.length || 0, numbers: phoneNumbers }

    // 5. Get last 10 calls for this workspace
    const { data: recentCalls, error: recentError } = await supabase
      .from('calls')
      .select('*')
      .eq('workspace_id', user.workspaceId)
      .order('created_at', { ascending: false })
      .limit(10)

    checks.recent_calls = recentError
      ? { status: 'ERROR', message: recentError.message }
      : { status: 'OK', count: recentCalls?.length || 0, calls: recentCalls }

    // 6. Check Telnyx API key is set
    checks.telnyx_api_key = process.env.TELNYX_API_KEY
      ? { status: 'OK', prefix: process.env.TELNYX_API_KEY.substring(0, 10) + '...' }
      : { status: 'MISSING' }

    // 7. Check webhook URL
    checks.webhook_url = {
      expected: `${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || 'UNKNOWN'}/api/webhooks/telnyx/call`,
      note: 'Make sure this URL is configured in your Telnyx portal under the Connection webhook settings'
    }

    return NextResponse.json({
      success: true,
      workspace_id: user.workspaceId,
      checks
    })
  } catch (error) {
    console.error('Debug endpoint error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
