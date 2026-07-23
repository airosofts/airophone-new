# Airophone RLS Data-Isolation Fix (Path A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Airophone data-isolation hole by enforcing Postgres Row-Level Security while keeping Supabase Realtime working, using Path A (server-minted, workspace-scoped Supabase JWTs).

**Architecture:** On login the browser fetches a short-lived Supabase JWT (`role: authenticated`, `workspace_id: <theirs>`) minted server-side and signed with the Supabase project JWT secret. supabase-js sends it (via the `accessToken` option) on every PostgREST query and Realtime frame, so the database sees each browser as an authenticated member of one workspace. RLS then (a) scopes the 5 tables the browser touches to that workspace, and (b) is enabled with **no** policy on every other table so the anonymous key is denied — the server keeps working because `service_role` bypasses RLS.

**Tech Stack:** Next.js 16 (App Router), `@supabase/supabase-js` ^2.99 (`accessToken` option), `jose` (HS256 JWT), Supabase Postgres RLS, Node 22 `node --test` (ESM auto-detected).

## Global Constraints

- Branch: `omar-RLS-fixed`. **Do not commit or push until the user explicitly approves** — the per-task commit steps below are prepared but gated on that go-ahead.
- All database work runs against the TEST Supabase project **`sayakmjcwleakvxzuujw`** only. The production project **`sebaeihdyfhbkqmmrjbh`** is NEVER touched by any task here.
- TEST DB direct connection (psql): `postgresql://postgres:Omar57faiz%40@db.sayakmjcwleakvxzuujw.supabase.co:5432/postgres?sslmode=require`
- The browser touches exactly 5 tables (direct query and/or Realtime): `calls`, `conversations`, `messages`, `phone_numbers`, `user_presence`. These get workspace-scoped `authenticated` policies. **Every other table** gets RLS enabled with no policy (deny anon; server unaffected).
- `service_role` bypasses RLS — every existing server route (`supabaseAdmin` / inline service-role clients) keeps full access unchanged. Do not change server route DB code.
- New server-only env var: `SUPABASE_JWT_SECRET` (Supabase Dashboard → Settings → API → JWT Settings → JWT Secret). Different from the app's `JWT_SECRET`. Never prefixed `NEXT_PUBLIC_`.
- Minted Supabase token claims (exact): `{ role: "authenticated", aud: "authenticated", sub: <user uuid>, workspace_id: <uuid>, iat, exp }`, HS256, signed with `SUPABASE_JWT_SECRET`.
- Token lifetime: 3600 seconds. Client refreshes at 80% of lifetime.
- `messages.workspace_id` already exists on the TEST DB (column + backfill + BEFORE INSERT trigger + FK + index) from environment setup; Task 2 ports the exact migration into the repo for production parity.
- Tests: `node --test` on `*.test.mjs` files under `tests/`. Pure logic only (no `next/server`, no `@/` alias) so Node can run it directly.

---

## File Structure

- `src/lib/supabaseToken.js` — **new.** Pure token minter: `mintSupabaseToken()`. No Next imports, no `@/` alias, only `jose` + `process.env`. Unit-tested.
- `tests/supabaseToken.test.mjs` — **new.** Unit tests for the minter.
- `src/app/api/auth/supabase-token/route.js` — **new.** Authenticated endpoint returning `{ token, expiresAt }` for the caller's workspace.
- `src/lib/supabaseBrowserAuth.js` — **new.** Browser-only token store + fetch/refresh: `getSupabaseToken()`, `refreshSupabaseToken()`, `startSupabaseTokenRefresh()`, `clearSupabaseToken()`.
- `src/lib/supabase.js` — **modify.** Add the `accessToken` option to both clients so every request/Realtime frame carries the workspace token.
- `src/hooks/useRealtime.js` — **modify.** Add explicit `workspace_id` filters to the three unfiltered `postgres_changes` subscriptions (defense in depth).
- `src/app/(auth)/login/page.js` — **modify.** Kick off the token fetch + refresh loop right after a successful login.
- `src/app/(dashboard)/layout.js` — **modify.** On dashboard mount (page reload with an existing session), ensure the token is fetched and the refresh loop is running.
- `database/rls/01-messages-workspace-id.sql` — **new.** The `messages.workspace_id` migration (column + backfill + trigger + FK + index).
- `database/rls/02-policies-browser-tables.sql` — **new.** Enable RLS + `authenticated` workspace policy on the 5 browser tables.
- `database/rls/03-lockdown-other-tables.sql` — **new.** Enable RLS (no policy) on every other public table.
- `database/rls/04-revoke-anon-writes.sql` — **new.** Revoke INSERT/UPDATE/DELETE/TRUNCATE from `anon` (containment).
- `database/rls/99-rollback.sql` — **new.** One-shot rollback (disable RLS everywhere, restore anon grants).
- `docs/superpowers/plans/2026-07-24-airophone-rls-path-a.md` — this plan.

---

## Task 1: Supabase token minter (`src/lib/supabaseToken.js`)

**Files:**
- Create: `airophone-new/src/lib/supabaseToken.js`
- Test: `airophone-new/tests/supabaseToken.test.mjs`

**Interfaces:**
- Produces: `mintSupabaseToken({ userId, workspaceId, secret, ttlSeconds = 3600 })` → `Promise<{ token: string, expiresAt: number }>`. `expiresAt` is epoch **milliseconds**. Throws `Error('userId and workspaceId are required')` if either is missing, and `Error('SUPABASE_JWT_SECRET is not set')` if `secret` is empty.
- Consumes: `jose` (`SignJWT`).

- [ ] **Step 1: Write the failing test**

Create `airophone-new/tests/supabaseToken.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd airophone-new && node --test tests/supabaseToken.test.mjs`
Expected: FAIL — `Cannot find module '../src/lib/supabaseToken.js'`.

- [ ] **Step 3: Write the minimal implementation**

Create `airophone-new/src/lib/supabaseToken.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd airophone-new && node --test tests/supabaseToken.test.mjs`
Expected: PASS — `# pass 4  # fail 0`.

- [ ] **Step 5: Commit**

```bash
git add airophone-new/src/lib/supabaseToken.js airophone-new/tests/supabaseToken.test.mjs
git commit -m "feat(rls): add Supabase token minter for Path A"
```

---

## Task 2: SQL migrations ported into the repo + verified on TEST DB

**Files:**
- Create: `airophone-new/database/rls/01-messages-workspace-id.sql`
- Create: `airophone-new/database/rls/02-policies-browser-tables.sql`
- Create: `airophone-new/database/rls/03-lockdown-other-tables.sql`
- Create: `airophone-new/database/rls/04-revoke-anon-writes.sql`
- Create: `airophone-new/database/rls/99-rollback.sql`

**Interfaces:**
- Produces: a repeatable, ordered SQL migration set. Files 01–04 are the forward migration; 99 is the rollback. All are idempotent (safe to re-run).
- Consumes: the 5 browser-table list and the "all other tables" set from the schema analysis.

- [ ] **Step 1: Write `01-messages-workspace-id.sql`**

```sql
-- Path A load-bearing change: messages gets a direct workspace_id so the RLS
-- policy is a single-column check Realtime evaluates cheaply. Additive and
-- backward-compatible (works with RLS off).
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS workspace_id uuid;

UPDATE public.messages m
SET workspace_id = c.workspace_id
FROM public.conversations c
WHERE c.id = m.conversation_id AND m.workspace_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_message_workspace_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT c.workspace_id INTO NEW.workspace_id
    FROM public.conversations c
    WHERE c.id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_message_workspace_id ON public.messages;
CREATE TRIGGER trg_set_message_workspace_id
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.set_message_workspace_id();

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_workspace_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON public.messages(workspace_id);
```

- [ ] **Step 2: Write `02-policies-browser-tables.sql`**

```sql
-- The 5 tables the browser reads/subscribes to. Enable RLS and add a policy
-- that scopes `authenticated` (Path A token) to its own workspace. `anon` has
-- no policy here -> denied. `service_role` bypasses RLS -> server unaffected.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages','conversations','calls','phone_numbers','user_presence']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON public.%I
        FOR ALL TO authenticated
        USING (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid)
        WITH CHECK (workspace_id = (auth.jwt() ->> 'workspace_id')::uuid);
    $f$, t);
  END LOOP;
END $$;
```

- [ ] **Step 3: Write `03-lockdown-other-tables.sql`**

```sql
-- Enable RLS on every other public table with NO policy: `anon` and
-- `authenticated` are both denied, closing the read hole on users, wallets,
-- super_admins, api_keys, etc. The server (service_role) bypasses RLS, so all
-- API routes keep working. Excludes the 5 browser tables handled in file 02.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> ALL (ARRAY['messages','conversations','calls','phone_numbers','user_presence'])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
```

- [ ] **Step 4: Write `04-revoke-anon-writes.sql`**

```sql
-- Immediate containment: strip write privileges from the public key's role.
-- Reversible with GRANT. `authenticated` (Path A logged-in browser) keeps its
-- grants, so the "delete conversation" browser action still works post-Path A.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon;
```

- [ ] **Step 5: Write `99-rollback.sql`**

```sql
-- One-shot rollback. Disables RLS on every public table and restores anon
-- write grants. Use if anything regresses during rollout.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon;
```

- [ ] **Step 6: Apply 01 to the TEST DB and verify the column/trigger**

Run:
```bash
export PGPASSWORD='Omar57faiz@'
CONN="postgresql://postgres@db.sayakmjcwleakvxzuujw.supabase.co:5432/postgres?sslmode=require"
psql -d "$CONN" -v ON_ERROR_STOP=1 -f airophone-new/database/rls/01-messages-workspace-id.sql
psql -d "$CONN" -tc "select count(*) filter (where workspace_id is null) as nulls, count(*) as total from public.messages;"
```
Expected: exit 0; `nulls` = 0 (all backfilled). (On the current TEST DB this is already applied and idempotent — re-running is a no-op.)

- [ ] **Step 7: Apply 02 + 03 + 04 to the TEST DB and verify RLS coverage**

Run:
```bash
psql -d "$CONN" -v ON_ERROR_STOP=1 -f airophone-new/database/rls/02-policies-browser-tables.sql
psql -d "$CONN" -v ON_ERROR_STOP=1 -f airophone-new/database/rls/03-lockdown-other-tables.sql
psql -d "$CONN" -v ON_ERROR_STOP=1 -f airophone-new/database/rls/04-revoke-anon-writes.sql
psql -d "$CONN" -tc "select count(*) from pg_tables where schemaname='public' and rowsecurity=false;"
psql -d "$CONN" -tc "select count(*) from pg_policies where schemaname='public' and policyname='tenant_isolation';"
psql -d "$CONN" -tc "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type in ('INSERT','UPDATE','DELETE');"
```
Expected: RLS-disabled tables = 0 (RLS on everywhere); `tenant_isolation` policies = 5; anon write grants = 0.

- [ ] **Step 8: Verify anon is now denied over PostgREST (the fix works)**

Run (uses the TEST anon key):
```bash
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNheWFrbWpjd2xlYWt2eHp1dWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTE5ODUsImV4cCI6MjA5OTE4Nzk4NX0.3siTHLKHSxPOJ1qUnWz1Ldq0UCeNBc0UwoOqip3578E"
URL="https://sayakmjcwleakvxzuujw.supabase.co"
echo -n "anon reads messages -> "; curl -s "$URL/rest/v1/messages?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
echo; echo -n "anon reads users -> "; curl -s "$URL/rest/v1/users?select=id&limit=1" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
```
Expected: both return `[]` (RLS denies — no rows), not data. (A `401`/empty is the win; the pre-fix behavior returned rows.)

- [ ] **Step 9: Commit**

```bash
git add airophone-new/database/rls/
git commit -m "feat(rls): add Path A + lockdown SQL migrations (verified on test db)"
```

---

## Task 3: Supabase-token endpoint (`/api/auth/supabase-token`)

**Files:**
- Create: `airophone-new/src/app/api/auth/supabase-token/route.js`

**Interfaces:**
- Consumes: `mintSupabaseToken` (Task 1); middleware-injected headers `x-user-id` and `x-workspace-id` (set by `src/middleware.js` for authenticated `/api/` requests).
- Produces: `GET /api/auth/supabase-token` → `200 { token: string, expiresAt: number }` for the caller's workspace, or `401 { error: 'Unauthorized' }` with no session, or `500 { error: 'Failed to mint token' }` if `SUPABASE_JWT_SECRET` is unset.
- This route requires a session — it is **not** added to `PUBLIC_API_ROUTES`, so the existing middleware perimeter guards it.

- [ ] **Step 1: Write the route**

Create `airophone-new/src/app/api/auth/supabase-token/route.js`:

```js
import { NextResponse } from 'next/server'
import { mintSupabaseToken } from '@/lib/supabaseToken'

// Returns a short-lived Supabase JWT scoped to the caller's workspace (Path A).
// Auth is enforced by middleware, which injects x-user-id / x-workspace-id.
export async function GET(request) {
  const userId = request.headers.get('x-user-id')
  const workspaceId = request.headers.get('x-workspace-id')
  if (!userId || !workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { token, expiresAt } = await mintSupabaseToken({
      userId,
      workspaceId,
      secret: process.env.SUPABASE_JWT_SECRET,
      ttlSeconds: 3600,
    })
    return NextResponse.json({ token, expiresAt })
  } catch (err) {
    console.error('supabase-token mint failed:', err.message)
    return NextResponse.json({ error: 'Failed to mint token' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Add `SUPABASE_JWT_SECRET` to the TEST env**

Get the value from the airophone-test project (Dashboard → Settings → API → JWT Settings → JWT Secret) and add to `airophone-new/.env.local`:

```
SUPABASE_JWT_SECRET="<test project JWT secret>"
```

(Do **not** commit `.env.local` — it is gitignored.)

- [ ] **Step 3: Manual verification against the running dev server**

Start dev (`cd airophone-new && npm run dev`), then:
```bash
# 1) unauthenticated -> 401
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/supabase-token   # expect 401
# 2) log in, capture the airo_session cookie, call with it
curl -s -c /tmp/airo.jar -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"omar@airosofts.com","password":"Omar57faiz@"}' >/dev/null
curl -s -b /tmp/airo.jar http://localhost:3000/api/auth/supabase-token
```
Expected: first call `401`; second returns `{"token":"eyJ...","expiresAt":<ms>}`. Decode the token's payload and confirm `role=authenticated`, `workspace_id=00000000-0000-0000-0000-00000000000a`.

- [ ] **Step 4: Prove the minted token passes RLS while anon does not**

```bash
TOKEN=$(curl -s -b /tmp/airo.jar http://localhost:3000/api/auth/supabase-token | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
URL="https://sayakmjcwleakvxzuujw.supabase.co"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNheWFrbWpjd2xlYWt2eHp1dWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTE5ODUsImV4cCI6MjA5OTE4Nzk4NX0.3siTHLKHSxPOJ1qUnWz1Ldq0UCeNBc0UwoOqip3578E"
echo -n "authenticated (Acme) reads messages -> "; curl -s "$URL/rest/v1/messages?select=body" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN"
```
Expected: returns ONLY Acme's 3 messages (the 3 `Acme ...` bodies), never the `Globex ...` row.

- [ ] **Step 5: Commit**

```bash
git add airophone-new/src/app/api/auth/supabase-token/route.js
git commit -m "feat(rls): add /api/auth/supabase-token endpoint (Path A)"
```

---

## Task 4: Browser token store + wire `accessToken` into supabase-js

**Files:**
- Create: `airophone-new/src/lib/supabaseBrowserAuth.js`
- Modify: `airophone-new/src/lib/supabase.js`

**Interfaces:**
- Produces:
  - `getSupabaseToken(): string | null` — current cached token (or null).
  - `refreshSupabaseToken(): Promise<string | null>` — fetches `/api/auth/supabase-token`, caches token + expiry, returns the token.
  - `startSupabaseTokenRefresh(): void` — fetches immediately and schedules a refresh at 80% of the token lifetime; idempotent (a second call clears the prior timer first).
  - `clearSupabaseToken(): void` — clears cache + timer (call on logout).
- Consumes: the endpoint from Task 3.
- `src/lib/supabase.js` gains `accessToken: async () => getSupabaseToken()` on both `createClient` calls so PostgREST + Realtime send the workspace token.

- [ ] **Step 1: Write the browser auth module**

Create `airophone-new/src/lib/supabaseBrowserAuth.js`:

```js
// Browser-only store for the Path A Supabase token. Kept in module scope so the
// supabase-js `accessToken` callback can read it synchronously on every request.
let currentToken = null
let expiresAt = 0          // epoch ms
let refreshTimer = null

export function getSupabaseToken() {
  return currentToken
}

export async function refreshSupabaseToken() {
  try {
    const res = await fetch('/api/auth/supabase-token', { credentials: 'include' })
    if (!res.ok) { currentToken = null; return null }
    const data = await res.json()
    currentToken = data.token
    expiresAt = data.expiresAt
    return currentToken
  } catch {
    currentToken = null
    return null
  }
}

export function startSupabaseTokenRefresh() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
  const schedule = () => {
    // refresh at 80% of remaining lifetime, floor 30s
    const lifetime = Math.max(expiresAt - Date.now(), 0)
    const delay = Math.max(Math.floor(lifetime * 0.8), 30_000)
    refreshTimer = setTimeout(async () => {
      await refreshSupabaseToken()
      schedule()
    }, delay)
  }
  return refreshSupabaseToken().then(() => { schedule() })
}

export function clearSupabaseToken() {
  currentToken = null
  expiresAt = 0
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
}
```

- [ ] **Step 2: Wire `accessToken` into `src/lib/supabase.js`**

Modify `airophone-new/src/lib/supabase.js`. Add the import at the top (after the existing `createClient` import):

```js
import { createClient } from '@supabase/supabase-js'
import { getSupabaseToken } from './supabaseBrowserAuth'
```

Add `accessToken` to **both** client configs (the `supabase` singleton and `createSupabaseClient`). The option is the supported supabase-js v2 way to supply a custom JWT for both PostgREST and Realtime:

```js
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => getSupabaseToken(),
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

export const createSupabaseClient = () => createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => getSupabaseToken(),
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})
```

When `accessToken` returns `null` (logged out, or before the first fetch), supabase-js falls back to the anon key — so nothing breaks pre-login; those requests are simply subject to RLS as `anon`.

- [ ] **Step 3: Start the refresh loop after login**

Modify `airophone-new/src/app/(auth)/login/page.js`. Find the successful-login branch (after `fetch('/api/auth/login')` resolves OK and before the redirect/`router.push`). Add:

```js
import { startSupabaseTokenRefresh } from '@/lib/supabaseBrowserAuth'
// ...inside the success handler, after the session is stored:
await startSupabaseTokenRefresh()
```

- [ ] **Step 4: Ensure the token loop runs on reload (existing session)**

Modify `airophone-new/src/app/(dashboard)/layout.js`. In the mount effect that reads `localStorage.getItem('user_session')` (around line 265), after confirming a session exists, start the loop:

```js
import { startSupabaseTokenRefresh } from '@/lib/supabaseBrowserAuth'
// ...inside the mount effect, once a valid user_session is confirmed:
startSupabaseTokenRefresh()
```

- [ ] **Step 5: Clear the token on logout**

Modify `airophone-new/src/app/(dashboard)/layout.js` (or wherever the logout handler POSTs to `/api/auth/logout`). Import and call `clearSupabaseToken()` in the logout handler:

```js
import { clearSupabaseToken } from '@/lib/supabaseBrowserAuth'
// ...in the logout handler, before redirecting to /login:
clearSupabaseToken()
```

- [ ] **Step 6: Manual verification — realtime + reads under RLS via the UI**

With `02/03/04` applied to the TEST DB and dev running:
1. Log in as `omar@airosofts.com` / `Omar57faiz@` (Acme). Open the inbox.
2. In a DB client, insert an Acme message and a Globex message:
   ```bash
   psql -d "$CONN" -c "insert into public.messages (conversation_id,direction,from_number,to_number,body) values ('20000000-0000-0000-0000-0000000000a1','inbound','+16041110001','+15551110001','LIVE acme test');"
   psql -d "$CONN" -c "insert into public.messages (conversation_id,direction,from_number,to_number,body) values ('20000000-0000-0000-0000-0000000000b1','inbound','+16042220001','+15552220001','LIVE globex test');"
   ```
3. Expected: the Acme message appears live in the inbox; the Globex message never arrives. Network tab shows requests to `*.supabase.co` carrying `Authorization: Bearer eyJ...` (the workspace token), not the anon key.

- [ ] **Step 7: Commit**

```bash
git add airophone-new/src/lib/supabaseBrowserAuth.js airophone-new/src/lib/supabase.js airophone-new/src/app/\(auth\)/login/page.js "airophone-new/src/app/(dashboard)/layout.js"
git commit -m "feat(rls): wire Path A workspace token into supabase-js client (accessToken + refresh)"
```

---

## Task 5: Harden the unfiltered Realtime subscriptions (defense in depth)

**Files:**
- Modify: `airophone-new/src/hooks/useRealtime.js` (subscriptions at ~lines 613, 666, 688)

**Interfaces:**
- Consumes: `workspaceId` — already in scope in this hook (used for the `phone_numbers` subscription at line 462 and the presence channels).
- Produces: the three `postgres_changes` subscriptions currently subscribing to whole tables gain a `filter: 'workspace_id=eq.<workspaceId>'`. Under Path A + RLS these are already safe (Realtime won't deliver cross-workspace rows), but the explicit filter is the report's §6 "defense in depth" and directly removes the "messages reaching the wrong browser" client-filtering path.

- [ ] **Step 1: Confirm the three unfiltered subscriptions**

Run: `cd airophone-new && grep -nE "postgres_changes|table: '(messages|conversations)'|filter:" src/hooks/useRealtime.js | sed -n '1,60p'`
Expected: three `{ event: ..., schema: 'public', table: 'messages'|'conversations' }` blocks (around lines 613, 666, 688) with **no** `filter:` key, alongside the already-filtered ones.

- [ ] **Step 2: Add the workspace filter to each of the three blocks**

For the `messages` subscription at ~line 613, change:

```js
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages'
        },
```
to:
```js
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `workspace_id=eq.${workspaceId}`
        },
```

Apply the identical change (add `filter: \`workspace_id=eq.${workspaceId}\`,` as the last key of the config object) to the `messages` block at ~line 666 and the `conversations` block at ~line 688. (Keep each block's existing `event`/`schema`/`table` values; only add the `filter`.)

> Note: `messages.workspace_id` exists (Task 2, file 01) and `conversations.workspace_id` already exists, so both filters resolve server-side.

- [ ] **Step 3: Guard against a missing workspaceId**

At the top of the effect that opens these three subscriptions (the `conversations_${normalizedFromNumber}` channel effect starting ~line 607), ensure it early-returns when `workspaceId` is falsy so the filter is never `workspace_id=eq.undefined`:

```js
    if (!workspaceId) return
```
(Place this next to the effect's existing guards, e.g. beside the `normalizedFromNumber` check. If such a guard already exists, no change is needed — verify and move on.)

- [ ] **Step 4: Manual verification**

Restart dev, log in as Acme, open the inbox, and repeat the two-insert test from Task 4 Step 6. Expected: identical correct behavior, and the Realtime subscription payloads in the Network/WS frames now carry the `workspace_id=eq.<acme>` filter param.

- [ ] **Step 5: Commit**

```bash
git add airophone-new/src/hooks/useRealtime.js
git commit -m "harden(rls): add explicit workspace_id filters to realtime subscriptions"
```

---

## Task 6: End-to-end isolation verification on the TEST DB

**Files:**
- Create: `airophone-new/database/rls/_verify.sh` (a throwaway verification script; not shipped to prod)

**Interfaces:**
- Consumes: everything above, applied to TEST DB `sayakmjcwleakvxzuujw`, dev server running.
- Produces: a documented pass/fail matrix proving isolation, anon denial, and server-route health.

- [ ] **Step 1: Write the verification script**

Create `airophone-new/database/rls/_verify.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
URL="https://sayakmjcwleakvxzuujw.supabase.co"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNheWFrbWpjd2xlYWt2eHp1dWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTE5ODUsImV4cCI6MjA5OTE4Nzk4NX0.3siTHLKHSxPOJ1qUnWz1Ldq0UCeNBc0UwoOqip3578E"

login() { curl -s -c "$2" -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "$1" >/dev/null; }
tok()   { curl -s -b "$1" http://localhost:3000/api/auth/supabase-token | python -c "import sys,json;print(json.load(sys.stdin)['token'])"; }

login '{"email":"omar@airosofts.com","password":"Omar57faiz@"}' /tmp/acme.jar
login '{"email":"bob@globex.test","password":"x"}'             /tmp/globex.jar
ACME=$(tok /tmp/acme.jar); GLOBEX=$(tok /tmp/globex.jar)

echo "1) anon denied on users:";     curl -s "$URL/rest/v1/users?select=id"    -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
echo "2) anon denied on messages:";  curl -s "$URL/rest/v1/messages?select=id" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
echo "3) Acme sees only Acme msgs:"; curl -s "$URL/rest/v1/messages?select=body" -H "apikey: $ANON" -H "Authorization: Bearer $ACME"
echo "4) Globex sees only Globex:";  curl -s "$URL/rest/v1/messages?select=body" -H "apikey: $ANON" -H "Authorization: Bearer $GLOBEX"
echo "5) server route still works:"; curl -s -b /tmp/acme.jar -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/conversations
```

- [ ] **Step 2: Run it and record the matrix**

Run: `cd airophone-new && bash database/rls/_verify.sh`
Expected:
- (1) `[]` — anon cannot read users.
- (2) `[]` — anon cannot read messages.
- (3) only the three `Acme ...` bodies.
- (4) only the `Globex ...` body.
- (5) `200` — the logged-in server route (service_role) still works.

- [ ] **Step 3: Confirm server-side writes still succeed under RLS**

Send a test SMS-style insert through a server route (service_role path). E.g. hit an authenticated endpoint that writes (or run the app's send-message flow in the UI) and confirm the row lands:
```bash
psql -d "$CONN" -tc "select body from public.messages order by created_at desc limit 1;"
```
Expected: the newly-sent message is present — proving `service_role` writes bypass RLS.

- [ ] **Step 4: Document the result**

Append the pass/fail matrix to this plan's execution notes (or the branch PR description when the user authorizes it). No commit of `_verify.sh` to prod code is required; it may be committed under `database/rls/` for reference.

- [ ] **Step 5: Commit (optional reference)**

```bash
git add airophone-new/database/rls/_verify.sh
git commit -m "test(rls): end-to-end isolation verification script"
```

---

## Production rollout (after TEST proof + user approval)

Not a coding task — the decoupled, reversible sequence from report §8:

1. Add `SUPABASE_JWT_SECRET` (production project) to the production server env only.
2. Deploy the code (Tasks 1, 3, 4, 5). It works whether RLS is on or off: pre-token requests fall back to anon; the server uses service_role throughout.
3. Apply `01-messages-workspace-id.sql` to production (additive, backward-compatible).
4. In a low-traffic window, apply `02` then `03` then `04`. If anything regresses, run `99-rollback.sql` (one line per concern, instantly reversible).
5. Watch the inbox + realtime; confirm isolation with two real accounts.

---

## Notes on scope (why this is more than the report's §7)

The report's §7 lists RLS policies on 5 tables. That alone scopes the browser's live data but leaves the other ~66 tables (users, wallets, super_admins, api_keys, payment_methods, …) readable by the anon key — the read hole the report's §1 describes. Task 2 file `03-lockdown-other-tables.sql` closes that by enabling RLS (deny-anon) on every non-browser table; the server is unaffected because `service_role` bypasses RLS. This is the load-bearing addition that makes the fix actually close the vulnerability, not just the realtime symptom.
