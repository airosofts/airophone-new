// =====================================
// api/telnyx/conference/create/route.js - NEW: Use proper conference creation
// =====================================
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
    
    const payload = {
      name: name,
      call_control_id: call_control_id,
      command_id: `conf_create_${Date.now()}`
    }
    
    console.log('Conference creation payload:', payload)
    
    // Use the dedicated conference creation endpoint
    const response = await fetch('https://api.telnyx.com/v2/conferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()
    console.log('Conference creation response:', { status: response.status, data })
    
    if (!response.ok) {
      console.error('Conference creation failed:', data)
      let errorMessage = 'Failed to create conference'
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
      conference_id: data.data.id,
      conference_name: data.data.name,
      data: data
    })

  } catch (error) {
    console.error('Conference creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}