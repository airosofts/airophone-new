import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch all scenarios for workspace
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data: scenarios, error } = await supabaseAdmin
      .from('scenarios')
      .select(`
        *,
        scenario_phone_numbers (
          phone_number_id,
          phone_numbers (
            phone_number,
            custom_name
          )
        ),
        scenario_contacts (
          recipient_phone,
          contact_id,
          contacts (
            business_name
          )
        )
      `)
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching scenarios:', error)
      return NextResponse.json(
        { error: 'Failed to fetch scenarios' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      scenarios
    })
  } catch (error) {
    console.error('Error in scenarios GET:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST - Create new scenario
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!user || !workspace) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { name, description, instructions, phoneNumbers, contacts } = body

    if (!name || !instructions) {
      return NextResponse.json(
        { error: 'Name and instructions are required' },
        { status: 400 }
      )
    }

    // Create scenario
    const { data: scenario, error: scenarioError } = await supabaseAdmin
      .from('scenarios')
      .insert({
        workspace_id: workspace.workspaceId,
        name,
        description: description || null,
        instructions,
        created_by: user.userId,
        is_active: true
      })
      .select()
      .single()

    if (scenarioError) {
      console.error('Error creating scenario:', scenarioError)
      return NextResponse.json(
        { error: 'Failed to create scenario' },
        { status: 500 }
      )
    }

    // Add phone number assignments (filter out null/invalid values)
    const validPhoneNumbers = phoneNumbers ? phoneNumbers.filter(phoneId => phoneId && phoneId !== 'null') : []
    if (validPhoneNumbers.length > 0) {
      const phoneNumberInserts = validPhoneNumbers.map(phoneId => ({
        scenario_id: scenario.id,
        phone_number_id: phoneId
      }))

      const { error: phoneError } = await supabaseAdmin
        .from('scenario_phone_numbers')
        .insert(phoneNumberInserts)

      if (phoneError) {
        console.error('Error assigning phone numbers:', phoneError)
      }
    }

    // Add contact restrictions (optional)
    if (contacts && contacts.length > 0) {
      const contactInserts = contacts.map(contact => ({
        scenario_id: scenario.id,
        recipient_phone: contact.phone,
        contact_id: contact.id && contact.id !== 'null' ? contact.id : null
      }))

      const { error: contactError } = await supabaseAdmin
        .from('scenario_contacts')
        .insert(contactInserts)

      if (contactError) {
        console.error('Error adding contact restrictions:', contactError)
      }
    }

    return NextResponse.json({
      success: true,
      scenario
    })
  } catch (error) {
    console.error('Error in scenarios POST:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
