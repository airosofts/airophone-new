import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jwtVerify } from 'jose'
import { mintSupabaseToken } from '../src/lib/supabaseToken.js'

const SECRET = 'test-secret-abcdefghijklmnopqrstuvwxyz-0123456789'
const enc = new TextEncoder().encode(SECRET)

test('mints an HS256 authenticated token with workspace_id', async () => {
  const { token, expiresAt } = await mintSupabaseToken({
    userId: '10000000-0000-0000-0000-00000000000a',
    workspaceId: '00000000-0000-0000-0000-00000000000a',
    secret: SECRET,
    ttlSeconds: 3600,
  })
  const { payload, protectedHeader } = await jwtVerify(token, enc)
  assert.equal(protectedHeader.alg, 'HS256')
  assert.equal(payload.role, 'authenticated')
  assert.equal(payload.aud, 'authenticated')
  assert.equal(payload.sub, '10000000-0000-0000-0000-00000000000a')
  assert.equal(payload.workspace_id, '00000000-0000-0000-0000-00000000000a')
  // expiresAt is epoch ms, ~1 hour out
  const deltaSec = Math.round((expiresAt - Date.now()) / 1000)
  assert.ok(deltaSec > 3500 && deltaSec <= 3600, `ttl was ${deltaSec}s`)
})

test('token signed with the wrong secret fails verification', async () => {
  const { token } = await mintSupabaseToken({
    userId: 'u', workspaceId: 'w', secret: SECRET,
  })
  const wrong = new TextEncoder().encode('a-different-secret-that-is-long-enough-000')
  await assert.rejects(() => jwtVerify(token, wrong))
})

test('rejects missing ids', async () => {
  await assert.rejects(
    () => mintSupabaseToken({ userId: '', workspaceId: 'w', secret: SECRET }),
    /userId and workspaceId are required/
  )
})

test('rejects empty secret', async () => {
  await assert.rejects(
    () => mintSupabaseToken({ userId: 'u', workspaceId: 'w', secret: '' }),
    /SUPABASE_JWT_SECRET is not set/
  )
})
