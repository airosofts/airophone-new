import { supabase } from './supabase'

// Login function
export async function loginWithEmailPassword(email, password) {
  try {
    // Authenticate directly against users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .eq('password_hash', password)
      .single()

    if (userError || !userData) {
      throw new Error('Invalid credentials')
    }

    // Check if user is active
    if (userData.is_active === false) {
      throw new Error('User account is not active')
    }

    // Check if user is a member of at least one active workspace
    const { data: workspaceMemberships, error: membershipError } = await supabase
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
      .eq('user_id', userData.id)
      .eq('is_active', true)
      .eq('workspaces.is_active', true)

    if (membershipError || !workspaceMemberships || workspaceMemberships.length === 0) {
      throw new Error('User is not a member of any active workspace')
    }

    // Get the default workspace or first available workspace
    let defaultWorkspace = workspaceMemberships[0]

    if (userData.default_workspace_id) {
      const userDefaultWorkspace = workspaceMemberships.find(
        m => m.workspace_id === userData.default_workspace_id
      )
      if (userDefaultWorkspace) {
        defaultWorkspace = userDefaultWorkspace
      }
    }

    // Create session object with workspace context
    const session = {
      userId: userData.id,
      email: userData.email,
      name: userData.name,
      role: userData.role,
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
      })),
      loginTime: new Date().toISOString()
    }

    // Store session in localStorage
    localStorage.setItem('user_session', JSON.stringify(session))

    return session
  } catch (error) {
    console.error('Login error:', error)
    throw error
  }
}

// Get current user from localStorage
export function getCurrentUser() {
  if (typeof window === 'undefined') return null

  const sessionString = localStorage.getItem('user_session')
  
  if (!sessionString) return null
  
  try {
    const session = JSON.parse(sessionString)
    
    // Validate session structure
    if (!session || !session.userId) return null

    // Check session expiration (7 days)
    if (session.loginTime) {
      const loginTime = new Date(session.loginTime)
      const now = new Date()
      const daysDiff = (now.getTime() - loginTime.getTime()) / (1000 * 60 * 60 * 24)
      
      if (daysDiff >= 7) {
        // Clear expired session
        localStorage.removeItem('user_session')
        return null
      }
    }

    return session
  } catch (error) {
    // Clear invalid session
    localStorage.removeItem('user_session')
    return null
  }
}

// Check if user is authenticated
export function isAuthenticated() {
  if (typeof window === 'undefined') return false

  const session = getCurrentUser()
  return !!session && !!session.userId
}

// Get user role
export function getUserRole() {
  const user = getCurrentUser()
  return user ? user.role : null
}

// Get workspace context from session
export function getWorkspaceContext() {
  const user = getCurrentUser()
  if (!user) return null

  return {
    workspaceId: user.workspaceId,
    workspaceName: user.workspaceName,
    workspaceSlug: user.workspaceSlug,
    workspaceRole: user.workspaceRole,
    messagingProfileId: user.messagingProfileId,
    billingGroupId: user.billingGroupId,
    availableWorkspaces: user.availableWorkspaces || []
  }
}

// Switch to a different workspace
export async function switchWorkspace(workspaceId) {
  if (typeof window === 'undefined') return false

  const user = getCurrentUser()
  if (!user) return false

  try {
    // Verify user has access to this workspace
    const { data: workspaceMembership, error } = await supabase
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
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .eq('workspaces.is_active', true)
      .single()

    if (error || !workspaceMembership) {
      throw new Error('Access denied to this workspace')
    }

    // Update session with new workspace context
    const updatedSession = {
      ...user,
      workspaceId: workspaceMembership.workspace_id,
      workspaceName: workspaceMembership.workspaces.name,
      workspaceSlug: workspaceMembership.workspaces.slug,
      workspaceRole: workspaceMembership.role,
      workspacePermissions: workspaceMembership.permissions,
      messagingProfileId: workspaceMembership.workspaces.messaging_profile_id,
      billingGroupId: workspaceMembership.workspaces.billing_group_id
    }

    localStorage.setItem('user_session', JSON.stringify(updatedSession))
    return true
  } catch (error) {
    console.error('Error switching workspace:', error)
    return false
  }
}

// Logout function
export function logout() {
  if (typeof window === 'undefined') return

  // Remove session from localStorage
  localStorage.removeItem('user_session')

  // Redirect to login
  window.location.href = '/login'
}