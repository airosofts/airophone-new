// Cron-driven sweeper for the voicemail (RVM) campaign queue.
//
// Called every minute by followup-cron with `Authorization: Bearer CRON_SECRET`.
// Delegates to the shared sweepRvmQueue() — the SAME logic the inline kick in
// /start uses, so cron and inline behave identically.
//
// Resilience: tab close / API restart don't matter (queue lives in Postgres);
// pausing a campaign makes the sweeper skip it; resuming picks up where it left.

import { NextResponse } from 'next/server'
import { sweepRvmQueue } from '@/lib/rvm-queue'

const BATCH_SIZE = 50

export async function POST(request) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    console.warn('[rvm:process-queue] 401 — auth mismatch', { hasSecret: !!secret, hasAuth: !!auth })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await sweepRvmQueue({ batchSize: BATCH_SIZE })
  if (result.picked > 0) {
    console.log('[rvm:process-queue] tick', result)
  }
  return NextResponse.json({ ok: true, ...result })
}
