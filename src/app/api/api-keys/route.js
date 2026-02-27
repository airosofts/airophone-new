import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { generateApiKey } from '@/lib/api-key-auth'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET /api/api-keys
// List all API keys for the current workspace (never returns the raw key)
export async function GET(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)

  if (!user || !workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, name, key_prefix, is_active, last_used_at, created_at')
    .eq('workspace_id', workspace.workspaceId)
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching API keys:', error)
    return NextResponse.json({ error: 'Failed to fetch API keys' }, { status: 500 })
  }

  return NextResponse.json({ keys: data || [] })
}

// POST /api/api-keys
// Create a new API key. Returns the raw key ONCE — it cannot be retrieved again.
export async function POST(request) {
  const user = getUserFromRequest(request)
  const workspace = getWorkspaceFromRequest(request)

  if (!user || !workspace) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  const name = body.name?.trim()

  if (!name) {
    return NextResponse.json({ error: 'A name is required for the API key' }, { status: 400 })
  }

  // Check limit: max 10 active keys per workspace
  const { count, error: countError } = await supabaseAdmin
    .from('api_keys')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspace.workspaceId)
    .eq('is_active', true)

  if (countError) {
    return NextResponse.json({ error: 'Failed to check key limit' }, { status: 500 })
  }

  if (count >= 10) {
    return NextResponse.json(
      { error: 'Maximum of 10 active API keys reached. Revoke an existing key first.' },
      { status: 400 }
    )
  }

  const { key, prefix, hash } = generateApiKey()

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .insert({
      workspace_id: workspace.workspaceId,
      user_id: user.userId,
      name,
      key_prefix: prefix,
      key_hash: hash,
      is_active: true
    })
    .select('id, name, key_prefix, is_active, created_at')
    .single()

  if (error) {
    console.error('Error creating API key:', error)
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }

  // Return the raw key ONLY here — it will never be retrievable again
  return NextResponse.json({
    key: data,
    rawKey: key,   // ← show this to the user once
    message: 'Copy this key now. It will not be shown again.'
  }, { status: 201 })
}
