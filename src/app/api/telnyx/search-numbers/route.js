import { NextResponse } from 'next/server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    // Build Telnyx API query parameters
    const params = new URLSearchParams()

    // Filter parameters - Only USA
    const locality = searchParams.get('locality')
    const administrativeArea = searchParams.get('administrative_area')
    const nationalDestinationCode = searchParams.get('national_destination_code')

    // Add to Telnyx params - Fixed to US
    params.append('filter[country_code]', 'US')

    if (locality) {
      params.append('filter[locality]', locality)
    }

    if (administrativeArea) {
      params.append('filter[administrative_area]', administrativeArea)
    }

    if (nationalDestinationCode) {
      params.append('filter[national_destination_code]', nationalDestinationCode)
    }

    // Limit results
    params.append('page[size]', '50')

    const telnyxApiKey = process.env.TELNYX_API_KEY

    if (!telnyxApiKey) {
      return NextResponse.json(
        { success: false, error: 'Telnyx API key not configured' },
        { status: 500 }
      )
    }

    const response = await fetch(
      `https://api.telnyx.com/v2/available_phone_numbers?${params}`,
      {
        headers: {
          'Authorization': `Bearer ${telnyxApiKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorData = await response.json()
      console.error('Telnyx API error:', errorData)
      return NextResponse.json(
        { success: false, error: 'Failed to fetch numbers from Telnyx' },
        { status: response.status }
      )
    }

    const data = await response.json()

    return NextResponse.json({
      success: true,
      numbers: data.data || [],
      meta: data.meta || {}
    })
  } catch (error) {
    console.error('Error searching numbers:', error)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    )
  }
}
