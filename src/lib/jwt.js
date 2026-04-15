import { SignJWT, jwtVerify } from 'jose'

const secret = new TextEncoder().encode(process.env.JWT_SECRET)
const COOKIE_NAME = 'airo_session'
const EXPIRES_IN = '7d'

/**
 * Sign a JWT with user/workspace payload
 */
export async function signToken(payload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(secret)
}

/**
 * Verify and decode a JWT
 */
export async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret)
    return payload
  } catch {
    return null
  }
}

/**
 * Build the Set-Cookie header value for the session
 */
export function buildSessionCookie(token) {
  const maxAge = 7 * 24 * 60 * 60 // 7 days in seconds
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

/**
 * Build a Set-Cookie that clears the session
 */
export function buildClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/**
 * Extract token from request cookies
 */
export function getTokenFromRequest(request) {
  const cookie = request.cookies.get(COOKIE_NAME)
  return cookie?.value || null
}

/**
 * Verify the session from a request and return the payload
 */
export async function getSessionFromRequest(request) {
  const token = getTokenFromRequest(request)
  if (!token) return null
  return verifyToken(token)
}

export { COOKIE_NAME }
