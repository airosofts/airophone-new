// GET /api/ai-models — the reply-model choices for scenario builders.
// `available: false` means the provider's API key isn't configured on the
// server; the UI shows those greyed out.

import { NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/session-helper'
import { listModels } from '@/lib/ai-models'

export async function GET(request) {
  const user = getUserFromRequest(request)
  if (!user?.workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ models: listModels() })
}
