import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!user || !workspace) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || 'month' // month | week | day

    const now = new Date()
    let periodStart, prevPeriodStart, prevPeriodEnd

    if (range === 'day') {
      periodStart = new Date(now); periodStart.setHours(0,0,0,0)
      prevPeriodEnd = new Date(periodStart)
      prevPeriodStart = new Date(periodStart); prevPeriodStart.setDate(prevPeriodStart.getDate() - 1)
    } else if (range === 'week') {
      periodStart = new Date(now); periodStart.setDate(now.getDate() - 6); periodStart.setHours(0,0,0,0)
      prevPeriodEnd = new Date(periodStart)
      prevPeriodStart = new Date(periodStart); prevPeriodStart.setDate(prevPeriodStart.getDate() - 7)
    } else {
      // month to date
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
      prevPeriodEnd = new Date(periodStart)
      prevPeriodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    }

    const wid = workspace.workspaceId

    // ── Get workspace phone numbers first (needed to scope messages + conversations) ──
    const { data: phoneNums } = await supabaseAdmin
      .from('phone_numbers')
      .select('phone_number')
      .eq('workspace_id', wid)

    const wsPhones = (phoneNums || []).map(p => p.phone_number)
    const ps = periodStart.toISOString()
    const pps = prevPeriodStart.toISOString()
    const ppe = prevPeriodEnd.toISOString()

    // ── Parallel fetch ──
    const [callsCur, callsPrev, msgsCur, msgsPrev, convCur, convPrev, members] = await Promise.all([
      supabaseAdmin.from('calls').select('*').eq('workspace_id', wid).gte('created_at', ps),
      supabaseAdmin.from('calls').select('*').eq('workspace_id', wid).gte('created_at', pps).lt('created_at', ppe),
      wsPhones.length
        ? supabaseAdmin.from('messages')
            .select('id, direction, from_number, to_number, created_at, user_id')
            .or(`from_number.in.(${wsPhones.join(',')}),to_number.in.(${wsPhones.join(',')})`)
            .gte('created_at', ps)
        : Promise.resolve({ data: [] }),
      wsPhones.length
        ? supabaseAdmin.from('messages')
            .select('id, direction, from_number, to_number, created_at, user_id')
            .or(`from_number.in.(${wsPhones.join(',')}),to_number.in.(${wsPhones.join(',')})`)
            .gte('created_at', pps).lt('created_at', ppe)
        : Promise.resolve({ data: [] }),
      wsPhones.length
        ? supabaseAdmin.from('conversations').select('id, created_at').in('from_number', wsPhones).gte('created_at', ps)
        : Promise.resolve({ data: [] }),
      wsPhones.length
        ? supabaseAdmin.from('conversations').select('id').in('from_number', wsPhones).gte('created_at', pps).lt('created_at', ppe)
        : Promise.resolve({ data: [] }),
      supabaseAdmin.from('workspace_members')
        .select('user_id, users(id, name, profile_photo_url, email)')
        .eq('workspace_id', wid).eq('is_active', true),
    ])

    const calls = callsCur.data || []
    const callsPrevData = callsPrev.data || []
    const msgs = msgsCur.data || []
    const msgsPrevData = msgsPrev.data || []
    const convs = convCur.data || []
    const convsPrevData = convPrev.data || []

    // ── KPIs ──
    const totalCalls = calls.length
    const prevTotalCalls = callsPrevData.length
    const answeredCalls = calls.filter(c => c.status === 'answered' || c.status === 'completed').length
    const prevAnsweredCalls = callsPrevData.filter(c => c.status === 'answered' || c.status === 'completed').length
    const outboundCalls = calls.filter(c => c.direction === 'outbound').length
    const prevOutboundCalls = callsPrevData.filter(c => c.direction === 'outbound').length
    const totalDurationSeconds = calls.reduce((s, c) => s + (c.duration_seconds || 0), 0)
    const prevTotalDurationSeconds = callsPrevData.reduce((s, c) => s + (c.duration_seconds || 0), 0)
    const sentMsgs = msgs.filter(m => m.direction === 'outbound').length
    const prevSentMsgs = msgsPrevData.filter(m => m.direction === 'outbound').length
    const totalMsgs = msgs.length
    const prevTotalMsgs = msgsPrevData.length
    const uniqueConvs = convs.length
    const prevUniqueConvs = convsPrevData.length

    // ── Per-user breakdown ──
    const userStats = (members.data || []).map(m => {
      const u = m.users
      if (!u) return null
      const uid = u.id
      const userCallsCur = calls.filter(c => c.user_id === uid)
      const userCallsPrev = callsPrevData.filter(c => c.user_id === uid)
      const userMsgsCur = msgs.filter(m2 => m2.user_id === uid && m2.direction === 'outbound')
      const userMsgsPrev = msgsPrevData.filter(m2 => m2.user_id === uid && m2.direction === 'outbound')
      return {
        id: uid,
        name: u.name || u.email,
        avatar: u.profile_photo_url || null,
        totalCalls: userCallsCur.length,
        prevTotalCalls: userCallsPrev.length,
        outboundCalls: userCallsCur.filter(c => c.direction === 'outbound').length,
        prevOutboundCalls: userCallsPrev.filter(c => c.direction === 'outbound').length,
        answeredCalls: userCallsCur.filter(c => c.status === 'answered' || c.status === 'completed').length,
        prevAnsweredCalls: userCallsPrev.filter(c => c.status === 'answered' || c.status === 'completed').length,
        durationSeconds: userCallsCur.reduce((s, c) => s + (c.duration_seconds || 0), 0),
        prevDurationSeconds: userCallsPrev.reduce((s, c) => s + (c.duration_seconds || 0), 0),
        sentMessages: userMsgsCur.length,
        prevSentMessages: userMsgsPrev.length,
      }
    }).filter(Boolean)

    // ── Trend for bar charts ──
    const buckets = range === 'day' ? 24 : range === 'week' ? 7 : 30
    const trend = []
    for (let i = buckets - 1; i >= 0; i--) {
      let label, bs, be
      if (range === 'day') {
        const h = new Date(now); h.setHours(now.getHours() - i, 0, 0, 0)
        const h2 = new Date(h); h2.setHours(h.getHours() + 1)
        label = `${h.getHours()}:00`; bs = h.toISOString(); be = h2.toISOString()
      } else {
        const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0,0,0,0)
        const d2 = new Date(d); d2.setDate(d.getDate() + 1)
        label = `${d.getMonth()+1}/${d.getDate()}`; bs = d.toISOString(); be = d2.toISOString()
      }
      const bucketMsgs = msgs.filter(m => m.created_at >= bs && m.created_at < be)
      const bucketCalls = calls.filter(c => c.created_at >= bs && c.created_at < be)
      trend.push({
        label,
        messages: bucketMsgs.length,
        messagesSent: bucketMsgs.filter(m => m.direction === 'outbound').length,
        messagesReceived: bucketMsgs.filter(m => m.direction === 'inbound').length,
        calls: bucketCalls.length,
        callsOutbound: bucketCalls.filter(c => c.direction === 'outbound').length,
        callsInbound: bucketCalls.filter(c => c.direction === 'inbound').length,
        conversations: convs.filter(c => c.created_at >= bs && c.created_at < be).length,
        durationSeconds: bucketCalls.reduce((s,c) => s + (c.duration_seconds||0), 0),
      })
    }

    // ── Busy times heatmap (7×24) ──
    const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0))
    ;[...calls, ...msgs].forEach(item => {
      const d = new Date(item.created_at)
      heatmap[(d.getDay() + 6) % 7][d.getHours()]++
    })

    return NextResponse.json({
      success: true, range,
      kpis: {
        totalCalls, prevTotalCalls,
        answeredCalls, prevAnsweredCalls,
        outboundCalls, prevOutboundCalls,
        totalDurationSeconds, prevTotalDurationSeconds,
        sentMessages: sentMsgs, prevSentMessages: prevSentMsgs,
        totalMessages: totalMsgs, prevTotalMessages: prevTotalMsgs,
        uniqueConversations: uniqueConvs, prevUniqueConversations: prevUniqueConvs,
      },
      userStats,
      trend,
      heatmap,
    })
  } catch (error) {
    console.error('[analytics] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
