// src/app/api/phone-numbers/route.js - Workspace-aware phone numbers
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import telnyx from '@/lib/telnyx'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

export async function GET(request) {
  try {
    console.log('=== Phone Numbers API Called ===')
    console.log('Timestamp:', new Date().toISOString())

    // Get workspace context from session
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      console.warn('No workspace context found in request')
      return NextResponse.json(
        { error: 'Unauthorized - No workspace context' },
        { status: 401 }
      )
    }

    console.log('Workspace context:', {
      workspaceId: workspace.workspaceId,
      messagingProfileId: workspace.messagingProfileId
    })

    // First, try to get cached phone numbers from database filtered by workspace
    let cachedNumbers = []
    try {
      const { data: dbNumbers, error: dbError } = await supabaseAdmin
        .from('phone_numbers')
        .select('*')
        .eq('workspace_id', workspace.workspaceId)
        .eq('is_active', true)

      if (!dbError && dbNumbers && dbNumbers.length > 0) {
        cachedNumbers = dbNumbers.map(phone => ({
          id: phone.id,
          phoneNumber: phone.phone_number,
          status: phone.status,
          messagingProfileId: phone.messaging_profile_id,
          voiceProfileId: phone.voice_profile_id,
          capabilities: phone.capabilities,
          purchasedAt: phone.purchased_at,
          custom_name: phone.custom_name
        }))

        // Deduplicate by phone number (keep the most recent entry)
        const uniqueNumbers = new Map()
        cachedNumbers.forEach(phone => {
          const existing = uniqueNumbers.get(phone.phoneNumber)
          if (!existing || new Date(phone.purchasedAt) > new Date(existing.purchasedAt)) {
            uniqueNumbers.set(phone.phoneNumber, phone)
          }
        })
        cachedNumbers = Array.from(uniqueNumbers.values())

        console.log(`Found ${cachedNumbers.length} unique cached numbers for workspace`)

        // Return cached numbers immediately
        return NextResponse.json({
          success: true,
          phoneNumbers: cachedNumbers,
          source: 'cache',
          timestamp: new Date().toISOString()
        })
      }
    } catch (cacheError) {
      console.warn('Error fetching from cache:', cacheError.message)
    }

    // If no cached numbers or cache failed, fetch from Telnyx
    console.log('Fetching phone numbers from Telnyx API...')
    const result = await telnyx.getPhoneNumbers()
    console.log('Telnyx API result:', { success: result.success, count: result.phoneNumbers?.length })

    if (!result.success) {
      console.error('Telnyx API failed:', result.error)
      return NextResponse.json(
        {
          error: 'Failed to fetch phone numbers from Telnyx',
          details: result.error,
          timestamp: new Date().toISOString()
        },
        { status: 500 }
      )
    }

    if (!result.phoneNumbers || result.phoneNumbers.length === 0) {
      console.warn('No phone numbers returned from Telnyx')
      return NextResponse.json({
        success: true,
        phoneNumbers: [],
        message: 'No phone numbers found. Please purchase phone numbers.',
        timestamp: new Date().toISOString()
      })
    }

    // Filter phone numbers by workspace messaging profile ID
    const workspacePhoneNumbers = workspace.messagingProfileId
      ? result.phoneNumbers.filter(phone => phone.messagingProfileId === workspace.messagingProfileId)
      : []

    console.log(`Filtered to ${workspacePhoneNumbers.length} phone numbers for workspace messaging profile`)

    // Try to cache in database
    try {
      if (workspacePhoneNumbers.length > 0) {
        console.log('Attempting to cache phone numbers in database...')

        // Upsert workspace phone numbers
        const phoneNumbersData = workspacePhoneNumbers.map(phone => ({
          id: phone.id,
          phone_number: phone.phoneNumber,
          workspace_id: workspace.workspaceId,
          status: phone.status,
          messaging_profile_id: phone.messagingProfileId,
          billing_group_id: workspace.billingGroupId,
          connection_id: phone.connectionId,
          is_active: true
        }))

        const { error: upsertError } = await supabaseAdmin
          .from('phone_numbers')
          .upsert(phoneNumbersData, {
            onConflict: 'id',
            ignoreDuplicates: false
          })

        if (upsertError) {
          console.warn('Error upserting phone numbers:', upsertError)
        } else {
          console.log('Successfully cached phone numbers in database')
        }
      }
    } catch (cacheError) {
      console.warn('Database caching failed (non-critical):', cacheError.message)
    }

    // Return workspace-filtered response
    return NextResponse.json({
      success: true,
      phoneNumbers: workspacePhoneNumbers,
      source: 'telnyx',
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('=== CRITICAL ERROR in phone numbers API ===')
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)

    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error.message,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  try {
    console.log('=== Phone Numbers Refresh API Called ===')

    // Get workspace context from session
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Unauthorized - No workspace context' },
        { status: 401 }
      )
    }

    const result = await telnyx.getPhoneNumbers()

    if (!result.success) {
      console.error('Failed to refresh from Telnyx:', result.error)
      return NextResponse.json(
        { error: 'Failed to refresh phone numbers', details: result.error },
        { status: 500 }
      )
    }

    // Filter phone numbers by workspace messaging profile ID
    const workspacePhoneNumbers = workspace.messagingProfileId
      ? result.phoneNumbers.filter(phone => phone.messagingProfileId === workspace.messagingProfileId)
      : []

    // Update cache
    try {
      if (workspacePhoneNumbers.length > 0) {
        // Mark existing workspace numbers as inactive
        await supabaseAdmin
          .from('phone_numbers')
          .update({ is_active: false })
          .eq('workspace_id', workspace.workspaceId)

        const phoneNumbersData = workspacePhoneNumbers.map(phone => ({
          id: phone.id,
          phone_number: phone.phoneNumber,
          workspace_id: workspace.workspaceId,
          status: phone.status,
          messaging_profile_id: phone.messagingProfileId,
          billing_group_id: workspace.billingGroupId,
          connection_id: phone.connectionId,
          is_active: true,
          updated_at: new Date().toISOString()
        }))

        await supabaseAdmin
          .from('phone_numbers')
          .upsert(phoneNumbersData, {
            onConflict: 'id'
          })

        console.log('Cache refresh successful')
      }
    } catch (error) {
      console.error('Error updating cache during refresh:', error)
    }

    return NextResponse.json({
      success: true,
      message: 'Phone numbers refreshed successfully',
      phoneNumbers: workspacePhoneNumbers,
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error in refresh API:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}

export async function PATCH(request) {
  try {
    console.log('=== Phone Numbers Update Custom Name API Called ===')

    // Get workspace context from session
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Unauthorized - No workspace context' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { phoneNumberId, customName } = body

    if (!phoneNumberId) {
      return NextResponse.json(
        { error: 'Phone number ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating custom name for phone number:', phoneNumberId, 'to:', customName)

    // Update custom_name in database
    const { data, error } = await supabaseAdmin
      .from('phone_numbers')
      .update({
        custom_name: customName,
        updated_at: new Date().toISOString()
      })
      .eq('id', phoneNumberId)
      .eq('workspace_id', workspace.workspaceId)
      .select()
      .single()

    if (error) {
      console.error('Error updating custom name:', error)
      return NextResponse.json(
        { error: 'Failed to update custom name', details: error.message },
        { status: 500 }
      )
    }

    console.log('Custom name updated successfully')

    return NextResponse.json({
      success: true,
      message: 'Custom name updated successfully',
      phoneNumber: {
        id: data.id,
        phoneNumber: data.phone_number,
        custom_name: data.custom_name
      },
      timestamp: new Date().toISOString()
    })

  } catch (error) {
    console.error('Error in PATCH API:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}