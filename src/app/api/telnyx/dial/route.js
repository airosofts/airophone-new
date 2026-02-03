// api/telnyx/dial/route.js - NEW: Separate endpoint for participant dialing
import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { to, from, connection_id } = await request.json()
    
    console.log('Dial request:', { to, from, connection_id })
    
    if (!to || !from || !connection_id) {
      return NextResponse.json(
        { error: 'Missing required fields: to, from, connection_id' },
        { status: 400 }
      )
    }
    
    // Clean and format numbers
    const cleanTo = to.replace(/\D/g, '')
    const cleanFrom = from.replace(/\D/g, '')
    
    const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`
    const formattedFrom = cleanFrom.startsWith('1') ? `+${cleanFrom}` : `+1${cleanFrom}`
    
    const dialPayload = {
      to: formattedTo,
      from: formattedFrom,
      connection_id: connection_id,
      timeout_secs: 30,
      time_limit_secs: 300,
      command_id: `dial_${Date.now()}`
    }
    
    console.log('Dial payload:', dialPayload)
    
    const response = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dialPayload),
    })

    const data = await response.json()
    console.log('Dial response:', { status: response.status, data })
    
    if (!response.ok) {
      console.error('Dial failed:', data)
      return NextResponse.json(
        { error: 'Failed to dial participant', details: data },
        { status: response.status }
      )
    }

    return NextResponse.json({
      success: true,
      call_control_id: data.data.call_control_id,
      call_session_id: data.data.call_session_id,
      data: data
    })

  } catch (error) {
    console.error('Error in dial route:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}