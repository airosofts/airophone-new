import { NextResponse } from 'next/server'
import { loginWithEmailPassword } from '@/lib/auth'

export async function POST(request) {
  try {
    const { email, password } = await request.json()

    // Authenticate user
    const session = await loginWithEmailPassword(email, password)

    return NextResponse.json({
      message: 'Login successful',
      user: {
        id: session.userId,
        email: session.email,
        name: session.name,
        role: session.role,
        workspaceId: session.workspaceId,
        workspaceName: session.workspaceName,
        workspaceSlug: session.workspaceSlug,
        workspaceRole: session.workspaceRole,
        messagingProfileId: session.messagingProfileId,
        billingGroupId: session.billingGroupId,
        availableWorkspaces: session.availableWorkspaces
      }
    })
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: error.message || 'Invalid credentials' },
      { status: 401 }
    )
  }
}