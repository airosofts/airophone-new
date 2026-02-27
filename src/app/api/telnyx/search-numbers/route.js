import { NextResponse } from 'next/server'

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)

    // Build Telnyx API query parameters
    const params = new URLSearchParams()

    const exactNumber = searchParams.get('exact_number')

    // If exact number provided, extract area code and search by it
    if (exactNumber) {
      // Strip everything except digits
      const digits = exactNumber.replace(/\D/g, '')
      // Remove leading 1 (country code) if present and 11 digits long
      const national = digits.startsWith('1') && digits.length >= 11 ? digits.slice(1) : digits
      // Extract area code (first 3 digits of national number)
      const areaCode = national.slice(0, 3)
      if (areaCode.length === 3) {
        params.append('filter[national_destination_code]', areaCode)
      }
      params.append('filter[country_code]', 'US')
    } else {
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
    }

    // Pagination support for number hunting
    const pageNum = searchParams.get('page_number')
    if (pageNum) params.append('page[number]', pageNum)
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

    let numbers = data.data || []

    // If exact number search, filter results client-side by the prefix
    if (exactNumber) {
      const digits = exactNumber.replace(/\D/g, '')
      const national = digits.startsWith('1') && digits.length >= 11 ? digits.slice(1) : digits
      if (national.length > 3) {
        numbers = numbers.filter(n => {
          const numDigits = n.phone_number.replace(/\D/g, '')
          const numNational = numDigits.startsWith('1') ? numDigits.slice(1) : numDigits
          return numNational.startsWith(national)
        })
      }
    }

    return NextResponse.json({
      success: true,
      numbers,
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
