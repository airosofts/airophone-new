import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export async function POST(request) {
  try {
    const userId = request.headers.get('x-user-id')
    const workspaceId = request.headers.get('x-workspace-id')
    if (!userId || !workspaceId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { code, plan_name } = await request.json()
    if (!code) return NextResponse.json({ error: 'Coupon code is required' }, { status: 400 })

    const { data: coupon, error } = await supabaseAdmin
      .from('coupons')
      .select('*')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .single()

    if (error || !coupon) {
      return NextResponse.json({ error: 'Invalid or expired coupon code' }, { status: 404 })
    }

    // Check expiry
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This coupon has expired' }, { status: 410 })
    }

    // Check max uses
    if (coupon.max_uses !== null && coupon.uses_count >= coupon.max_uses) {
      return NextResponse.json({ error: 'This coupon has reached its usage limit' }, { status: 410 })
    }

    // Check min plan requirement
    const planOrder = { starter: 1, growth: 2, enterprise: 3 }
    if (coupon.min_plan && plan_name) {
      const requiredLevel = planOrder[coupon.min_plan] || 0
      const selectedLevel = planOrder[plan_name] || 0
      if (selectedLevel < requiredLevel) {
        return NextResponse.json({
          error: `This coupon requires the ${coupon.min_plan} plan or higher`,
        }, { status: 422 })
      }
    }

    // Check if this workspace already used this coupon
    const { data: existing } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('id')
      .eq('coupon_id', coupon.id)
      .eq('workspace_id', workspaceId)
      .single()

    if (existing) {
      return NextResponse.json({ error: 'You have already used this coupon' }, { status: 409 })
    }

    return NextResponse.json({
      success: true,
      coupon: {
        id: coupon.id,
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: coupon.discount_value,
        description: coupon.description,
      },
    })
  } catch (err) {
    console.error('[coupons/validate]', err)
    return NextResponse.json({ error: 'Failed to validate coupon' }, { status: 500 })
  }
}
