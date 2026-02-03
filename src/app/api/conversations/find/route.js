import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { normalizePhoneNumber } from '@/lib/phone-utils'

export async function POST(request) {
  try {
    const { phone_number, from_number } = await request.json()

    if (!phone_number) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    // Normalize phone numbers
    const normalizedPhoneNumber = normalizePhoneNumber(phone_number)
    const normalizedFromNumber = from_number ? normalizePhoneNumber(from_number) : null

    // Look for existing conversation with this phone number and from_number
    let { data: conversation, error } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('phone_number', normalizedPhoneNumber)
      .eq('from_number', normalizedFromNumber)
      .single()

    // If no exact match, try to find conversation with just phone number
    if (error && error.code === 'PGRST116') {
      let { data: existingConversation } = await supabaseAdmin
        .from('conversations')
        .select('*')
        .eq('phone_number', normalizedPhoneNumber)
        .single()

      // If conversation exists but from_number is different, update it
      if (existingConversation) {
        const { data: updatedConversation, error: updateError } = await supabaseAdmin
          .from('conversations')
          .update({ 
            from_number: normalizedFromNumber 
          })
          .eq('id', existingConversation.id)
          .select()
          .single()

        if (updateError) {
          console.error('Error updating conversation:', updateError)
        }

        conversation = updatedConversation || existingConversation
      } else {
        // Create new conversation if doesn't exist
        const { data: newConversation, error: createError } = await supabaseAdmin
          .from('conversations')
          .insert({
            phone_number: normalizedPhoneNumber,
            from_number: normalizedFromNumber,
            name: null
          })
          .select()
          .single()

        if (createError) {
          console.error('Error creating conversation:', createError)
          return NextResponse.json(
            { error: 'Failed to create conversation' },
            { status: 500 }
          )
        }

        conversation = newConversation
      }
    } else if (error) {
      console.error('Error finding conversation:', error)
      return NextResponse.json(
        { error: 'Failed to find conversation' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      conversation
    })

  } catch (error) {
    console.error('Error in find conversation API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}