import { NextResponse } from 'next/server'
import { processScheduledFollowups } from '@/lib/followup-service'

// This endpoint should be called by a cron job every 5-15 minutes
// You can use services like Vercel Cron, Upstash QStash, or cron-job.org

export async function GET(request) {
  try {
    // Verify cron secret to prevent unauthorized access
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    console.log('Processing scheduled follow-ups...')

    const result = await processScheduledFollowups()

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      ...result
    })

  } catch (error) {
    console.error('Error in process-followups cron:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  // Allow POST method as well for flexibility
  return GET(request)
}
