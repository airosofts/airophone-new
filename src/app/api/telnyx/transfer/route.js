// =====================================
// api/telnyx/transfer/route.js - CORRECTED
// =====================================
import { NextResponse } from 'next/server'

export async function POST(request) {
  try {
    const { call_control_id, to, from } = await request.json()
    
    console.log('Transfer request:', { call_control_id, to, from })
    
    if (!call_control_id || !to) {
      return NextResponse.json(
        { error: 'Missing required fields: call_control_id and to' },
        { status: 400 }
      )
    }
    
    // Format phone numbers to +E.164
    const cleanTo = to.replace(/\D/g, '')
    const formattedTo = cleanTo.startsWith('1') ? `+${cleanTo}` : `+1${cleanTo}`
    
    let transferPayload = {
      to: formattedTo,
      command_id: `transfer_${Date.now()}`
    }
    
    // Add from number if provided
    if (from) {
      const cleanFrom = from.replace(/\D/g, '')
      const formattedFrom = cleanFrom.startsWith('1') ? `+${cleanFrom}` : `+1${cleanFrom}`
      transferPayload.from = formattedFrom
    }
    
    console.log('Transfer payload:', transferPayload)
    
    const response = await fetch(`https://api.telnyx.com/v2/calls/${call_control_id}/actions/transfer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transferPayload),
    })

    const data = await response.json()
    console.log('Transfer response:', { status: response.status, data })
    
    if (!response.ok) {
      console.error('Transfer failed:', data)
      let errorMessage = 'Transfer failed'
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
    console.error('Transfer route error:', error)
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    )
  }
}
