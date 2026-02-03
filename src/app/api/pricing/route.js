import { NextResponse } from 'next/server'
import { getWorkspaceFromRequest } from '@/lib/session-helper'
import { getWorkspacePricingInfo, MESSAGE_PRICING_TIERS } from '@/lib/pricing'

export async function GET(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const pricingInfo = await getWorkspacePricingInfo(workspace.workspaceId)

    return NextResponse.json({
      success: true,
      ...pricingInfo,
      tiers: MESSAGE_PRICING_TIERS
    })
  } catch (error) {
    console.error('Error fetching pricing info:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pricing information' },
      { status: 500 }
    )
  }
}
