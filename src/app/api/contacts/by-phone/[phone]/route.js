import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  
  if (digits.length === 10) {
    return `+1${digits}`
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    return phone
  }
  
  return `+1${digits}`
}

export async function GET(request, { params }) {
  try {
    const { phone } = await params
    const phoneNumber = decodeURIComponent(phone)
    const normalizedPhone = normalizePhoneNumber(phoneNumber)
    const workspace = getWorkspaceFromRequest(request)

    console.log('Looking up contact by phone:', phoneNumber, 'normalized:', normalizedPhone)

    let query = supabaseAdmin
      .from('contacts')
      .select(`*, contact_lists!left(name)`)
      .eq('phone_number', normalizedPhone)

    // Filter by workspace when context is available
    if (workspace?.workspaceId) {
      query = query.eq('workspace_id', workspace.workspaceId)
    }

    // NOTE: do NOT use .single() — the same number can have duplicate contact
    // rows (imported into multiple lists), and .single() throws on >1 match,
    // which made the panel see "no contact" and create yet another duplicate.
    // Fetch all matches and pick the best: prefer one that already has a status
    // (so the real disposition shows), otherwise the most recently updated.
    const { data: rows, error } = await query.order('updated_at', { ascending: false })

    if (error) {
      console.error('Database error finding contact:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      )
    }

    const contact = (rows || []).find(r => r.status) || (rows || [])[0] || null

    if (!contact) {
      return NextResponse.json({
        success: true,
        contact: null
      })
    }

    console.log('Found contact:', contact.id)

    return NextResponse.json({
      success: true,
      contact
    })

  } catch (error) {
    console.error('Error in contact by phone API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}