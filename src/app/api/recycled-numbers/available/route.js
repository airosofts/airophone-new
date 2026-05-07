import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('recycled_numbers')
      .select('id, phone_number, quarantine_until, entered_cycle_at')
      .or('status.eq.available,and(status.eq.quarantine,quarantine_until.lt.' + new Date().toISOString() + ')')
      .order('entered_cycle_at', { ascending: true })
      .limit(20)

    if (error) throw error

    return NextResponse.json({ numbers: data || [] })
  } catch (error) {
    console.error('[recycled-numbers/available]', error)
    return NextResponse.json({ numbers: [] })
  }
}
