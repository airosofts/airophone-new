// Session validation and migration utility
import { getCurrentUser, logout } from './auth'
import { supabase } from './supabase'

/**
 * Validates if the current session has workspace context
 * If not, attempts to upgrade the session or forces re-login
 */
export async function validateAndUpgradeSession() {
  if (typeof window === 'undefined') return null

  const user = getCurrentUser()

  if (!user) {
    return null
  }

  // Check if session has workspace context
  if (user.workspaceId && user.messagingProfileId) {
    return user // Session is valid
  }

  console.warn('Session missing workspace context - attempting to upgrade...')

  try {
    // Fetch workspace membership for this user
    const { data: workspaceMemberships, error } = await supabase
      .from('workspace_members')
      .select(`
        id,
        workspace_id,
        role,
        permissions,
        is_active,
        workspaces!inner (
          id,
          name,
          slug,
          messaging_profile_id,
          billing_group_id,
          is_active,
          settings
        )
      `)
      .eq('user_id', user.userId)
      .eq('is_active', true)
      .eq('workspaces.is_active', true)

    if (error || !workspaceMemberships || workspaceMemberships.length === 0) {
      console.error('User has no workspace memberships - forcing logout')
      logout()
      return null
    }

    // Get default workspace
    const defaultWorkspace = workspaceMemberships[0]

    // Upgrade session with workspace context
    const upgradedSession = {
      ...user,
      workspaceId: defaultWorkspace.workspace_id,
      workspaceName: defaultWorkspace.workspaces.name,
      workspaceSlug: defaultWorkspace.workspaces.slug,
      workspaceRole: defaultWorkspace.role,
      workspacePermissions: defaultWorkspace.permissions,
      messagingProfileId: defaultWorkspace.workspaces.messaging_profile_id,
      billingGroupId: defaultWorkspace.workspaces.billing_group_id,
      availableWorkspaces: workspaceMemberships.map(m => ({
        id: m.workspace_id,
        name: m.workspaces.name,
        slug: m.workspaces.slug,
        role: m.role
      }))
    }

    // Save upgraded session
    localStorage.setItem('user_session', JSON.stringify(upgradedSession))

    console.log('Session upgraded successfully with workspace context')

    // Reload page to apply changes
    window.location.reload()

    return upgradedSession
  } catch (error) {
    console.error('Failed to upgrade session:', error)

    // Force re-login on critical failure
    alert('Your session needs to be updated. Please login again.')
    logout()

    return null
  }
}

/**
 * Check if session is valid (has workspace context)
 */
export function isSessionValid() {
  const user = getCurrentUser()
  return user && user.workspaceId && user.messagingProfileId
}
