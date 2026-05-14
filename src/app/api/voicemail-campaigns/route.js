// List + create voicemail campaigns for the current workspace.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

export async function GET(request) {
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .select('*')
    .eq('workspace_id', workspace.workspaceId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[voicemail-campaigns:GET]', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaigns: data || [] })
}

export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)
  if (!workspace?.workspaceId || !user?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const { name, recordingUrl, recordingPath, senderNumber, contactListIds } = body

  if (!name || !recordingUrl || !senderNumber || !Array.isArray(contactListIds) || contactListIds.length === 0) {
    return NextResponse.json(
      { error: 'name, recordingUrl, senderNumber, and at least one contactListId are required' },
      { status: 400 }
    )
  }

  // Sender number must belong to this workspace AND be voicedrop_verified
  const { data: pn } = await supabaseAdmin
    .from('phone_numbers')
    .select('id, voicedrop_verified')
    .eq('phone_number', senderNumber)
    .eq('workspace_id', workspace.workspaceId)
    .maybeSingle()

  if (!pn) {
    return NextResponse.json({ error: 'Sender number not found in this workspace' }, { status: 400 })
  }
  if (!pn.voicedrop_verified) {
    return NextResponse.json({ error: 'Sender number is not yet verified with VoiceDrop' }, { status: 400 })
  }

  const { data: campaign, error } = await supabaseAdmin
    .from('voicemail_campaigns')
    .insert({
      workspace_id: workspace.workspaceId,
      created_by: user.userId,
      name,
      recording_url: recordingUrl,
      recording_path: recordingPath || null,
      sender_number: senderNumber,
      contact_list_ids: contactListIds,
      status: 'draft',
    })
    .select()
    .single()

  if (error) {
    console.error('[voicemail-campaigns:POST]', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }

  return NextResponse.json({ success: true, campaign })
}
