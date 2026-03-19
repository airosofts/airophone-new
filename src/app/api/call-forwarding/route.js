import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getUserFromRequest } from '@/lib/session-helper'

const TELNYX_HEADERS = {
  'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
  'Content-Type': 'application/json'
}

/**
 * Enable/disable Telnyx's native call forwarding on a phone number.
 * This works at the network level — no webhook latency.
 */
async function setTelnyxCallForwarding(phoneNumber, forwardTo, enabled) {
  // Find the Telnyx phone number ID
  const listRes = await fetch(
    `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}&page[size]=1`,
    { headers: TELNYX_HEADERS }
  )
  const listData = await listRes.json()
  const telnyxPhone = listData.data?.[0]

  if (!telnyxPhone) {
    console.error('Phone not found on Telnyx:', phoneNumber)
    return { success: false, error: 'Phone number not found on Telnyx' }
  }

  // Format destination
  let formattedTo = ''
  if (enabled && forwardTo) {
    const cleanTo = forwardTo.replace(/\D/g, '')
    formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`
  }

  // Update voice settings with native call forwarding
  const voiceRes = await fetch(
    `https://api.telnyx.com/v2/phone_numbers/${telnyxPhone.id}/voice`,
    {
      method: 'PATCH',
      headers: TELNYX_HEADERS,
      body: JSON.stringify({
        call_forwarding: {
          call_forwarding_enabled: enabled,
          forwards_to: enabled ? formattedTo : '',
          forwarding_type: enabled ? 'always' : ''
        }
      })
    }
  )

  const voiceData = await voiceRes.json()
  console.log('[call-forwarding] Telnyx voice update:', voiceRes.status, JSON.stringify(voiceData))

  if (!voiceRes.ok) {
    return { success: false, error: voiceData.errors?.[0]?.detail || 'Telnyx API error', details: voiceData }
  }

  return { success: true, data: voiceData.data }
}

// GET - List forwarding rules for workspace
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = createSupabaseServerClient()

    const { data: rules, error } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number, custom_name)')
      .eq('workspace_id', user.workspaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching forwarding rules:', error)
      return NextResponse.json({ error: 'Failed to fetch forwarding rules' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rules: rules || [] })
  } catch (error) {
    console.error('Error in call-forwarding GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a forwarding rule
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phone_number_id, forward_to } = await request.json()

    if (!phone_number_id || !forward_to) {
      return NextResponse.json(
        { error: 'Missing required fields: phone_number_id and forward_to' },
        { status: 400 }
      )
    }

    const supabase = createSupabaseServerClient()

    // Get the phone number to enable Telnyx forwarding
    const { data: phoneRec } = await supabase
      .from('phone_numbers')
      .select('phone_number')
      .eq('id', phone_number_id)
      .single()

    if (!phoneRec) {
      return NextResponse.json({ error: 'Phone number not found' }, { status: 404 })
    }

    // Enable Telnyx native call forwarding
    const telnyxResult = await setTelnyxCallForwarding(phoneRec.phone_number, forward_to, true)
    if (!telnyxResult.success) {
      return NextResponse.json(
        { error: `Failed to enable forwarding on Telnyx: ${telnyxResult.error}`, details: telnyxResult.details },
        { status: 500 }
      )
    }

    // Deactivate any existing active rule for this phone number
    await supabase
      .from('call_forwarding_rules')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('phone_number_id', phone_number_id)
      .eq('is_active', true)

    // Create new rule in our DB
    const { data: rule, error } = await supabase
      .from('call_forwarding_rules')
      .insert({
        workspace_id: user.workspaceId,
        phone_number_id,
        forward_to,
        is_active: true,
        created_by: user.userId
      })
      .select('*, phone_numbers(phone_number, custom_name)')
      .single()

    if (error) {
      console.error('Error creating forwarding rule:', error)
      return NextResponse.json({ error: 'Failed to create forwarding rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rule, telnyx: telnyxResult.data })
  } catch (error) {
    console.error('Error in call-forwarding POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Update a forwarding rule (toggle active, change destination)
export async function PATCH(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id, is_active, forward_to } = await request.json()

    if (!id) {
      return NextResponse.json({ error: 'Missing rule id' }, { status: 400 })
    }

    const supabase = createSupabaseServerClient()

    // Get current rule with phone number
    const { data: currentRule } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number)')
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .single()

    if (!currentRule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const phoneNumber = currentRule.phone_numbers?.phone_number
    const newForwardTo = forward_to || currentRule.forward_to
    const newActive = typeof is_active === 'boolean' ? is_active : currentRule.is_active

    // Update Telnyx native forwarding
    if (phoneNumber) {
      const telnyxResult = await setTelnyxCallForwarding(phoneNumber, newForwardTo, newActive)
      if (!telnyxResult.success) {
        return NextResponse.json(
          { error: `Failed to update Telnyx forwarding: ${telnyxResult.error}` },
          { status: 500 }
        )
      }
    }

    // Update our DB
    const updates = { updated_at: new Date().toISOString() }
    if (typeof is_active === 'boolean') updates.is_active = is_active
    if (forward_to) updates.forward_to = forward_to

    const { data: rule, error } = await supabase
      .from('call_forwarding_rules')
      .update(updates)
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .select('*, phone_numbers(phone_number, custom_name)')
      .single()

    if (error) {
      console.error('Error updating forwarding rule:', error)
      return NextResponse.json({ error: 'Failed to update forwarding rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rule })
  } catch (error) {
    console.error('Error in call-forwarding PATCH:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Remove a forwarding rule
export async function DELETE(request) {
  try {
    const user = getUserFromRequest(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing rule id' }, { status: 400 })
    }

    const supabase = createSupabaseServerClient()

    // Get the rule to disable Telnyx forwarding
    const { data: rule } = await supabase
      .from('call_forwarding_rules')
      .select('*, phone_numbers(phone_number)')
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)
      .single()

    if (rule?.phone_numbers?.phone_number) {
      // Disable Telnyx native forwarding
      await setTelnyxCallForwarding(rule.phone_numbers.phone_number, '', false)
    }

    // Delete from our DB
    const { error } = await supabase
      .from('call_forwarding_rules')
      .delete()
      .eq('id', id)
      .eq('workspace_id', user.workspaceId)

    if (error) {
      console.error('Error deleting forwarding rule:', error)
      return NextResponse.json({ error: 'Failed to delete forwarding rule' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in call-forwarding DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
