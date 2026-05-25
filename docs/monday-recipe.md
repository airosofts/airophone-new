# Monday Integration Recipe — Developer Center configuration

This is the canonical config to paste into **monday.com Developer Center → your
app → Features → Integration**. It defines the AiroPhone action that monday
users compose into recipes like:

> *When an item is created, send an AiroPhone SMS to {Phone column} from {AiroPhone number} saying {Message}.*

The trigger (`item is created`, `column changes`, etc.) is monday-native —
we only contribute the **action** below.

---

## 1. Custom action: "Send AiroPhone SMS"

| Field | Value |
|---|---|
| **Name** | Send AiroPhone SMS |
| **Description** | Text the lead through AiroPhone — replies handled by AI. |
| **URL** (action endpoint) | `https://app.airophone.com/api/integrations/monday/recipe/execute` |
| **Subscribe URL** | `https://app.airophone.com/api/integrations/monday/recipe/subscribe` |
| **Unsubscribe URL** | `https://app.airophone.com/api/integrations/monday/recipe/unsubscribe` |
| **Method** | `POST` |
| **HTTP timeout** | 30s |
| **Authorization** | Inherit (Monday signs the JWT with the app signing secret) |

### Input fields

| Name | Type | Required | Notes |
|---|---|---|---|
| `boardId` | Board (monday-native) | yes | auto-filled from the recipe context |
| `itemId` | Item ID (monday-native) | yes | auto-filled from the trigger |
| `phoneColumnId` | Column-picker (filter: `phone, phone-legacy, text`) | yes | the column on the board that holds the lead's mobile |
| `senderNumberId` | Custom dropdown — see §2 | yes | which AiroPhone number to send from |
| `messageTemplate` | Long text | yes | supports `{pulse.name}`, `{pulse.<columnTitle>}`, `{{column_slug}}` |

### Recipe sentence

> When **{trigger}**, send an AiroPhone SMS to **{phoneColumnId}** from **{senderNumberId}** saying **{messageTemplate}**.

---

## 2. Custom field type: "AiroPhone sender number"

Used by the `senderNumberId` input above. A dropdown whose options are fetched
live from AiroPhone (the user's own purchased numbers).

| Field | Value |
|---|---|
| **Name** | AiroPhone sender number |
| **URL** (remote options) | `https://app.airophone.com/api/integrations/monday/recipe/fields/sender-numbers` |
| **Method** | `POST` |
| **Response shape** | `[ { "title": "+1 320 315 8316", "value": "<uuid>" } ]` |

If the user hasn't connected AiroPhone yet, the dropdown returns a single
informational option telling them to do so — the action endpoint will then
no-op for that recipe instance.

---

## 3. Auth

Every request from monday.com to any of the URLs above carries an
`Authorization: Bearer <JWT>` header signed by monday with our app's
**Signing Secret**. We verify it in [`lib/monday-recipe.js`](../src/lib/monday-recipe.js)
using the `MONDAY_SIGNING_SECRET` env var — the *same* secret that already
verifies board webhooks.

If you ever rotate the signing secret in the Developer Center, update
`MONDAY_SIGNING_SECRET` in both `apportal/.env.local` (dev) and the Vercel
production env.

---

## 4. Test flow

1. In Developer Center → **App permissions**, ensure `boards:read`,
   `boards:write`, `me:read`, `account:read`, `workspaces:read`,
   `webhooks:write` are checked.
2. In Developer Center → **Integration** feature, paste the URLs above.
3. Promote a build to "Live" and install on your dev monday account.
4. Inside monday: open a board → Integrate → search "AiroPhone" → pick the
   recipe → fill the fields → enable.
5. Create a new item with a phone number in the configured column. Watch
   the apportal logs:
   ```
   [monday-recipe/execute] inbound { ... }
   [monday-recipe/execute] sent  { workspaceId, itemId, conversation }
   ```
6. Check `monday_recipe_runs` for the row.

---

## 5. Dedup & retry semantics

- **Subscribe** is idempotent — re-running it upserts on `integration_id`.
- **Execute** dedups on `(integration_id, monday_item_id)` so monday retries
  never double-send.
- **Pending** rows (phone column not filled yet) get retried by the existing
  `/api/automations/process-pending` sweeper — extend that sweeper to also
  scan `monday_recipe_runs` once we observe real-world pendings.
- We always return 200 to monday even on logical failures, because monday
  treats non-200 as a transport retry. Logical state lives in `monday_recipe_runs`.

---

## 6. Files of interest

- [`src/lib/monday-recipe.js`](../src/lib/monday-recipe.js) — JWT verify + account→workspace lookup + `withRecipeAuth` wrapper.
- [`src/app/api/integrations/monday/recipe/execute/route.js`](../src/app/api/integrations/monday/recipe/execute/route.js) — the action handler.
- [`src/app/api/integrations/monday/recipe/subscribe/route.js`](../src/app/api/integrations/monday/recipe/subscribe/route.js) — install hook.
- [`src/app/api/integrations/monday/recipe/unsubscribe/route.js`](../src/app/api/integrations/monday/recipe/unsubscribe/route.js) — uninstall hook.
- [`src/app/api/integrations/monday/recipe/fields/sender-numbers/route.js`](../src/app/api/integrations/monday/recipe/fields/sender-numbers/route.js) — dropdown options.
- [`migrations/2026-05-26-monday-recipe-tables.sql`](../migrations/2026-05-26-monday-recipe-tables.sql) — `monday_recipe_subscriptions` + `monday_recipe_runs`.
