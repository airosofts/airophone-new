// api/telnyx/conference/route.js - CORRECTED Conference Creation
import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { name, call_control_id } = await request.json()
    
    console.log('Creating conference:', { name, call_control_id })
    
    if (!name || !call_control_id) {
      return NextResponse.json(
        { error: 'Missing required fields: name and call_control_id' },
        { status: 400 }
      )
    }
    
    // Join the main call to the conference (this creates the conference)
    const response = await fetch(`https://api.telnyx.com/v2/calls/${call_control_id}/actions/conference_join`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conference_name: name,
        command_id: `conf_create_${Date.now()}`,
        start_conference_on_enter: true,
        end_conference_on_exit: false,
        hold_media_on_enter: false,
        muted_on_enter: false
      }),
    })

    const data = await response.json()
    console.log('Conference creation response:', { status: response.status, data })
    
    if (!response.ok) {
      console.error('Conference creation failed:', data)
      return NextResponse.json(
        { error: 'Failed to create conference', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      conference_name: name,
      data: data
    })

  } catch (error) {
    console.error('Error creating conference:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
