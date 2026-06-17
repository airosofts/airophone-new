// SMS campaign queue sweeper — called every minute by followup-cron with
// `Authorization: Bearer CRON_SECRET`. Sends a batch of queued campaign
// messages; honors pause (skips paused campaigns) and schedule (future
// scheduled_at isn't picked up until due).
import { NextResponse } from 'next/server'
import { sweepSmsCampaignQueue } from '@/lib/sms-campaign-queue'

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await sweepSmsCampaignQueue({ batchSize: 50 })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[campaigns/process-queue] error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
