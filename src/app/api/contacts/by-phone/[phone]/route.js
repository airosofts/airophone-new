import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

function normalizePhoneNumber(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  
  if (digits.length === 10) {
    return `+1${digits}`
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    return phone
  }
  
  return `+1${digits}`
}

export async function GET(request, { params }) {
  try {
    const phoneNumber = decodeURIComponent(params.phone)
    const normalizedPhone = normalizePhoneNumber(phoneNumber)
    
    console.log('Looking up contact by phone:', phoneNumber, 'normalized:', normalizedPhone)

    // Try to find contact with normalized phone number
    const { data: contact, error } = await supabaseAdmin
      .from('contacts')
      .select(`
        *,
        contact_lists!left(name)
      `)
      .eq('phone_number', normalizedPhone)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Database error finding contact:', error)
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
      )
    }

    if (!contact) {
      return NextResponse.json({
        success: true,
        contact: null
      })
    }

    console.log('Found contact:', contact.id)

    return NextResponse.json({
      success: true,
      contact
    })

  } catch (error) {
    console.error('Error in contact by phone API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}