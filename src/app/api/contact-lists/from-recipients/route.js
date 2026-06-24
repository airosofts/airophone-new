// POST /api/contact-lists/from-recipients
//
// Saves a selected set of recipients as a NEW reusable contact list. Built for
// the RVM "landline scrub" flow: after a carrier scan you can keep only the
// line types you want (e.g. mobile + voip, drop landlines) and save that as a
// clean list — WITHOUT re-paying for the lookups.
//
// Why copies, not a re-point: a contact belongs to exactly one list
// (contacts.contact_list_id is a single FK), so "save as a new list" while
// leaving the original list intact means copying the rows. Each copy carries
// over its cached `line_type`, so the new list is already scrubbed and a future
// scan of it is free (the landline-scan endpoint reads that cache).

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const LINE_TYPES = ['mobile', 'voip', 'landline', 'unknown']

export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const name = (body?.name || '').trim()
    const contactIds = Array.isArray(body?.contactIds)
      ? [...new Set(body.contactIds.filter(Boolean))]
      : []
    // Optional carrier map { "+15551234567": "mobile" } from the scrub, and the
    // set of line types the user chose to keep. When present we both filter the
    // copies AND stamp line_type onto them so re-scanning the new list is free.
    const lineTypeByPhone = body?.lineTypeByPhone && typeof body.lineTypeByPhone === 'object'
      ? body.lineTypeByPhone
      : null
    const includeLineTypes = Array.isArray(body?.includeLineTypes)
      ? body.includeLineTypes.filter(t => LINE_TYPES.includes(t))
      : null

    if (!name) {
      return NextResponse.json({ error: 'List name is required' }, { status: 400 })
    }
    if (contactIds.length === 0) {
      return NextResponse.json({ error: 'No contacts selected to save' }, { status: 400 })
    }

    // 1) Pull the source contacts (workspace-scoped) in batches.
    const COPYABLE = 'first_name, last_name, business_name, phone_number, email, address, city, state, country, custom_fields, line_type, line_type_checked_at, status'
    const sources = []
    for (let i = 0; i < contactIds.length; i += 300) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .select(`id, ${COPYABLE}`)
        .eq('workspace_id', workspace.workspaceId)
        .in('id', contactIds.slice(i, i + 300))
      if (error) {
        console.error('[from-recipients] fetch contacts error:', error)
        return NextResponse.json({ error: 'Failed to read selected contacts' }, { status: 500 })
      }
      if (data) sources.push(...data)
    }

    if (sources.length === 0) {
      return NextResponse.json({ error: 'Selected contacts could not be found' }, { status: 404 })
    }

    // 2) Resolve each contact's effective line type (fresh scan map wins over the
    //    cached column) and apply the keep-filter. De-dupe by phone.
    const breakdown = { mobile: 0, voip: 0, landline: 0, unknown: 0 }
    const byPhone = new Map()
    for (const c of sources) {
      const phone = c.phone_number
      if (!phone) continue
      const lt = (lineTypeByPhone && lineTypeByPhone[phone]) || c.line_type || 'unknown'
      if (includeLineTypes && !includeLineTypes.includes(lt)) continue
      if (byPhone.has(phone)) continue
      breakdown[lt] = (breakdown[lt] || 0) + 1
      byPhone.set(phone, { ...c, _lineType: lt })
    }

    if (byPhone.size === 0) {
      return NextResponse.json(
        { error: 'No contacts match the selected line types' },
        { status: 400 }
      )
    }

    // 3) Create the list.
    const { data: list, error: listError } = await supabaseAdmin
      .from('contact_lists')
      .insert({ name, workspace_id: workspace.workspaceId, created_by: user.userId })
      .select()
      .single()
    if (listError || !list) {
      console.error('[from-recipients] create list error:', listError)
      return NextResponse.json({ error: 'Failed to create the list' }, { status: 500 })
    }

    // 4) Insert the copies, carrying line_type so the new list stays scrubbed
    //    (no re-charge on a future scan).
    const rows = [...byPhone.values()].map(c => ({
      first_name: c.first_name || null,
      last_name: c.last_name || null,
      business_name: c.business_name || null,
      phone_number: c.phone_number,
      email: c.email || null,
      address: c.address || null,
      city: c.city || null,
      state: c.state || null,
      country: c.country || null,
      custom_fields: c.custom_fields || null,
      status: c.status || null,
      line_type: c._lineType !== 'unknown' ? c._lineType : (c.line_type || null),
      line_type_checked_at: c.line_type_checked_at || null,
      contact_list_id: list.id,
      workspace_id: workspace.workspaceId,
      created_by: user.userId,
    }))

    let inserted = 0
    for (let i = 0; i < rows.length; i += 500) {
      const { error: insErr, count } = await supabaseAdmin
        .from('contacts')
        .insert(rows.slice(i, i + 500), { count: 'exact' })
      if (insErr) {
        console.error('[from-recipients] insert contacts error:', insErr)
        // Roll back the (now partly-populated) list so we don't strand a broken one.
        await supabaseAdmin.from('contacts').delete().eq('contact_list_id', list.id)
        await supabaseAdmin.from('contact_lists').delete().eq('id', list.id)
        return NextResponse.json({ error: 'Failed to save contacts to the list' }, { status: 500 })
      }
      inserted += count ?? rows.slice(i, i + 500).length
    }

    return NextResponse.json({
      success: true,
      list: { id: list.id, name: list.name },
      inserted,
      breakdown,
    })
  } catch (error) {
    console.error('[from-recipients] unexpected:', error)
    return NextResponse.json({ error: 'Internal server error', details: error.message }, { status: 500 })
  }
}
