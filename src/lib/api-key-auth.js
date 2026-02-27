import crypto from 'crypto'
import { supabaseAdmin } from './supabase-server'

/**
 * Hash an API key with SHA-256 for safe storage.
 * We never store the raw key — only the hash.
 */
export function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

/**
 * Generate a new API key.
 * Format: airo_live_<32 random hex chars>
 * Returns: { key, prefix, hash }
 *  - key    → full key shown to user ONCE at creation
 *  - prefix → first 22 chars stored for display ("airo_live_" + 12 chars + "…")
 *  - hash   → SHA-256 stored in DB for validation
 */
export function generateApiKey() {
  const random = crypto.randomBytes(32).toString('hex')
  const key = `airo_live_${random}`
  const prefix = key.substring(0, 22)   // "airo_live_" + 12 hex chars
  const hash = hashApiKey(key)
  return { key, prefix, hash }
}

/**
 * Validate an API key from an Authorization header.
 * Returns { userId, workspaceId, keyId } on success, or null on failure.
 *
 * Usage:
 *   const auth = await validateApiKey(request.headers.get('authorization'))
 *   if (!auth) return 401
 */
export async function validateApiKey(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const rawKey = authHeader.slice(7).trim()

  if (!rawKey.startsWith('airo_live_')) {
    return null
  }

  const hash = hashApiKey(rawKey)

  const { data, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, workspace_id, user_id')
    .eq('key_hash', hash)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return null
  }

  // Fire-and-forget: update last_used_at without blocking the response
  supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {})
    .catch(() => {})

  return {
    userId: data.user_id,
    workspaceId: data.workspace_id,
    keyId: data.id
  }
}
