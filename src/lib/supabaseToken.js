import { SignJWT } from 'jose'

/**
 * Mint a short-lived Supabase JWT for Path A.
 * The token authenticates the browser to Supabase as an `authenticated`
 * member of exactly one workspace, so RLS (and Realtime) can scope its access.
 *
 * @param {Object} args
 * @param {string} args.userId       - the app user id (goes in `sub`)
 * @param {string} args.workspaceId  - the workspace the session is scoped to
 * @param {string} args.secret       - the Supabase project JWT secret (HS256)
 * @param {number} [args.ttlSeconds] - token lifetime, default 3600
 * @returns {Promise<{ token: string, expiresAt: number }>} expiresAt is epoch ms
 */
export async function mintSupabaseToken({ userId, workspaceId, secret, ttlSeconds = 3600 }) {
  if (!userId || !workspaceId) throw new Error('userId and workspaceId are required')
  if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set')

  const nowSec = Math.floor(Date.now() / 1000)
  const expSec = nowSec + ttlSeconds
  const key = new TextEncoder().encode(secret)

  const token = await new SignJWT({ role: 'authenticated', workspace_id: workspaceId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setAudience('authenticated')
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(key)

  return { token, expiresAt: expSec * 1000 }
}
