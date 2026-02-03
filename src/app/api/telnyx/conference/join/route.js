// =====================================
// api/telnyx/conference/join/route.js - For joining additional participants
// =====================================
import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { conference_name, call_control_id } = await request.json()
    
    console.log('Joining conference:', { conference_name, call_control_id })
    
    if (!conference_name || !call_control_id) {
      return NextResponse.json(
        { error: 'Missing required fields: conference_name and call_control_id' },
        { status: 400 }
      )
    }
    
    const response = await fetch(`https://api.telnyx.com/v2/calls/${call_control_id}/actions/conference_join`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conference_name: conference_name,
        command_id: `conf_join_${Date.now()}`,
        start_conference_on_enter: false,
        end_conference_on_exit: false
      }),
    })

    const data = await response.json()
    console.log('Conference join response:', { status: response.status, data })
    
    if (!response.ok) {
      console.error('Conference join failed:', data)
      let errorMessage = 'Failed to join conference'
      if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
        errorMessage = data.errors[0].detail || data.errors[0].title || errorMessage
      }
      
      return NextResponse.json(
        { error: errorMessage, details: data },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      data: data
    })

  } catch (error) {
    console.error('Conference join error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
