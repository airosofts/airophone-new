import { NextResponse } from 'next/server'

// Telnyx failover webhook — must return 200 immediately to stop Telnyx retrying
export async function POST(request) {
  try {
    const body = await request.text()
    console.warn('[telnyx-failover] Received failover event:', body.slice(0, 200))
  } catch {}
  return NextResponse.json({ received: true })
}

export async function GET() {
  return NextResponse.json({ status: 'failover endpoint active' })
}
