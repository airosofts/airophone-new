// API client with automatic workspace context headers
import { getCurrentUser } from './auth'

/**
 * Fetch wrapper that automatically includes workspace context headers
 * @param {string} url - The API endpoint URL
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export async function fetchWithWorkspace(url, options = {}) {
  // Only works in browser context
  if (typeof window === 'undefined') {
    throw new Error('API client can only be used in browser context')
  }

  const user = getCurrentUser()

  if (!user) {
    console.error('User not authenticated - session:', localStorage.getItem('user_session'))
    throw new Error('User not authenticated')
  }

  // Log for debugging
  console.log('API Request:', {
    url,
    workspaceId: user.workspaceId,
    messagingProfileId: user.messagingProfileId
  })

  // Merge headers with workspace context
  const headers = {
    'x-user-id': user.userId || '',
    'x-workspace-id': user.workspaceId || '',
    'x-messaging-profile-id': user.messagingProfileId || '',
    ...options.headers
  }

  // Only add Content-Type if not FormData (browser sets it automatically for FormData)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(url, {
    ...options,
    headers
  })
}

/**
 * GET request with workspace context
 */
export async function apiGet(url) {
  return fetchWithWorkspace(url, { method: 'GET' })
}

/**
 * POST request with workspace context
 */
export async function apiPost(url, body) {
  return fetchWithWorkspace(url, {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

/**
 * PUT request with workspace context
 */
export async function apiPut(url, body) {
  return fetchWithWorkspace(url, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
}

/**
 * DELETE request with workspace context
 */
export async function apiDelete(url) {
  return fetchWithWorkspace(url, { method: 'DELETE' })
}
