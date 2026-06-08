// Landline scrub for the RVM wizard.
// Given a list of phone numbers, returns the mobile / voip / landline / unknown
// breakdown via Telnyx Number Lookup. Results are CACHED on contacts.line_type
// so a number is only ever paid for once. Charges 0.5 credit per NEW lookup.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { lookupManyLineTypes } from '@/lib/number-lookup'

const CREDITS_PER_LOOKUP = 0.5
const MAX_SCAN = 3000   // synchronous cap; narrow the selection for larger lists

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const phones = [...new Set((Array.isArray(body.phones) ? body.phones : []).filter(p => typeof p === 'string' && p.length >= 8))]

  if (phones.length === 0) return NextResponse.json({ error: 'No numbers to scan' }, { status: 400 })
  if (phones.length > MAX_SCAN) {
    return NextResponse.json({ error: `Too many numbers to scan at once (max ${MAX_SCAN.toLocaleString()}). Narrow your selection and scan again.` }, { status: 400 })
  }

  // 1) Pull any cached line types so we don't pay to re-check.
  const cache = new Map()   // phone -> line_type
  for (let i = 0; i < phones.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('phone_number, line_type')
      .eq('workspace_id', workspace.workspaceId)
      .in('phone_number', phones.slice(i, i + 200))
      .not('line_type', 'is', null)
    for (const r of (data || [])) if (r.line_type && !cache.has(r.phone_number)) cache.set(r.phone_number, r.line_type)
  }
  const uncached = phones.filter(p => !cache.has(p))

  // 2) Credit check for the NEW lookups only.
  const cost = uncached.length * CREDITS_PER_LOOKUP
  const { data: wallet } = await supabaseAdmin
    .from('wallets').select('id, credits').eq('workspace_id', workspace.workspaceId).single()
  const available = Number(wallet?.credits || 0)
  if (uncached.length > 0 && available < cost) {
    return NextResponse.json({ error: 'Insufficient credits', required: cost, available }, { status: 402 })
  }

  // 3) Look up the uncached numbers via Telnyx.
  const fresh = uncached.length > 0 ? await lookupManyLineTypes(uncached, { concurrency: 12 }) : new Map()

  // 4) Charge for the new lookups + log a transaction.
  if (uncached.length > 0 && wallet?.id) {
    await supabaseAdmin.from('wallets')
      .update({ credits: Math.max(0, available - cost), updated_at: new Date().toISOString() })
      .eq('id', wallet.id)
    await supabaseAdmin.from('transactions').insert({
      workspace_id: workspace.workspaceId,
      user_id: user.userId,
      type: 'number_lookup',
      credits: -cost,
      amount: 0,
      currency: 'USD',
      description: `Landline scan — ${uncached.length} number lookup${uncached.length === 1 ? '' : 's'}`,
      status: 'completed',
    })
  }

  // 5) Cache the fresh results onto every contact row with that number.
  const now = new Date().toISOString()
  const byType = { mobile: [], voip: [], landline: [], unknown: [] }
  for (const [phone, lt] of fresh) (byType[lt] || byType.unknown).push(phone)
  for (const [lt, list] of Object.entries(byType)) {
    for (let i = 0; i < list.length; i += 200) {
      await supabaseAdmin.from('contacts')
        .update({ line_type: lt, line_type_checked_at: now })
        .eq('workspace_id', workspace.workspaceId)
        .in('phone_number', list.slice(i, i + 200))
    }
  }

  // 6) Build the full breakdown (cached + fresh).
  const byPhone = {}
  const breakdown = { mobile: 0, voip: 0, landline: 0, unknown: 0, total: phones.length }
  for (const p of phones) {
    const lt = cache.get(p) || fresh.get(p) || 'unknown'
    byPhone[p] = lt
    breakdown[lt] = (breakdown[lt] || 0) + 1
  }

  return NextResponse.json({
    success: true,
    breakdown,
    byPhone,
    newLookups: uncached.length,
    cached: phones.length - uncached.length,
    creditsCharged: cost,
    balance: Math.max(0, available - cost),
  })
}
