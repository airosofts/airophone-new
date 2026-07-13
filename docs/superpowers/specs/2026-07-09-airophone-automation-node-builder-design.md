# AiroPhone Automations — Drag-and-Drop Node Builder (Design Spec)

**Date:** 2026-07-09
**Status:** Draft for review (no implementation yet)

**Goal:** Replace the fixed 4-card automation editor with a React-Flow drag-and-drop
node canvas of the **same 4 blocks**, made draggable and joinable, with node
positions remembered — **without changing the automation's behavior or engine.**

**Architecture:** A React-Flow canvas inside `AutomationBuilder.js` renders 4 custom
nodes that mirror today's cards. On save, the canvas is flattened back to the
**existing flat columns** (so the execution engine is untouched) **and** the visual
graph is persisted to **one new nullable `graph` jsonb column**. The automation is
still a single-action flow (one of each node, wired in a line).

**Tech stack:** Next.js 16 (existing), `@xyflow/react` (React Flow — new dependency,
same library the DeelMap admin builder uses), existing `/api/automations` routes.

---

## Global Constraints

- **No new trigger types, no condition/branch node, no new actions.** Only the 4
  blocks that already exist in the automations feature.
- **One instance of each node.** Linear wiring only. **Trigger + Send-a-text are
  required; When-to-send + Sync-back are optional.**
- **The execution engine (`process-pending`), the existing columns, and all
  existing automation rows are unchanged.** This is a UI upgrade plus one additive column.
- **Exactly one DB change:** a nullable `graph jsonb` column. Additive,
  non-breaking, no data migration, no engine change.
- **TEST Supabase first.** The migration is applied to a TEST/staging AiroPhone
  Supabase before production. Production (`sebaeihdyfhbkqmmrjbh`) is never touched directly.
- Styling uses **AiroPhone's own palette** (red send, indigo trigger/timing, green
  sync), 4px-radius cards with colored headers.

---

## The 4 Nodes

| Node | Fields (unchanged from today) | Handles | Required |
|---|---|---|---|
| **⚡ Trigger** — "When this happens" | Monday board · trigger event (`create_item` / `change_column_value` / `move_item_to_group`) · phone-number column | out only | **required** |
| **⏱ When to send** — Wait | send delay (amount + unit) · business hours (`anytime` / `within` / `outside`) | in + out | optional |
| **💬 Send a text** | sender number · Template/AI toggle · message body (`{{column}}` token chips) | in + out | **required** |
| **🔁 Sync back to Monday** | on-sent / on-reply / on-done → column id + type (`status`/`date`/`text`) + value | in only | optional |

Node config UIs reuse the exact inputs from the current cards (see
`AutomationBuilder.js` FlowCards) — no field changes.

---

## Canvas Behavior

- **Palette** offers the 4 node types; a type already on the canvas is disabled
  (one-of-each cap).
- Trigger + Send are seeded on a new automation; When-to-send + Sync can be
  added/removed.
- Nodes connect left-to-right in a single line:
  `Trigger → [When to send] → Send a text → [Sync]`.
- **Validation before "Create Automation"** (same rules the current form enforces):
  a Trigger node and a Send node must exist and all their required fields be filled.
- Node positions are captured on drag and saved into the `graph` column.

---

## Data Model Change (the only backend change)

```sql
-- Additive, nullable, idempotent. Apply to TEST project first.
alter table public.monday_automations add column if not exists graph jsonb;
alter table public.sheets_automations  add column if not exists graph jsonb;
```

- `graph` stores the React-Flow document: `{ nodes: [...], edges: [...] }` with each
  node's `id`, `type`, `position {x,y}`, and `data` (its config) — exactly like
  DeelMap's `followup_flows.graph`.
- No other column changes. No changes to `monday_automation_sends`,
  `monday_writeback_configs`, or any engine table.

---

## Save Flow (behavior preserved)

On "Create/Update Automation", the builder produces the **same payload as today**
plus the graph:

- Trigger node → `board_id`, `board_name`, `trigger_event`, `phone_column_id`
- When-to-send node → `send_delay_seconds`, `business_hours_mode`
- Send node → `sender_phone_number_id`, `message_mode`, `message_template` / `ai_instructions`
- Sync node → the existing `monday_writeback_configs` upsert (via `/api/automations/writeback`)
- **New:** `graph` → the new `graph` column

`POST` / `PATCH /api/automations` writes the flat columns exactly as now, and
additionally persists `graph`. **The engine reads only the flat columns — it never
looks at `graph`.**

---

## Load Flow (backward compatible)

- The editor needs the automation's `graph`. Today there is **no GET-by-id route**
  (the editor fetches the whole list and filters client-side). Minimal change: include
  `graph` in the automations list `select`, **or** add `GET /api/automations/[id]`.
- If `graph` is present → render it verbatim (positions restored).
- If `graph` is null (the 3 existing automations, or any created before this feature)
  → **synthesize the 4 nodes from the flat columns and auto-layout** them
  left-to-right. Saving then backfills `graph`. No existing automation breaks.

---

## Scope

- **v1: the Monday path** (the screenshotted `/automations/new`).
- **Sheets path** (`sheets_automations`) uses **identical node shapes**; it gets the
  same `graph` column and can ship at the same time or as an immediate fast-follow.
  (Only the Trigger node's picker differs: spreadsheet/sheet vs board.)

---

## Testing (on the TEST project only)

1. Create an automation through the new canvas → assert the **flat columns** are
   written identically to the old form, and `graph` is stored.
2. Reload the automation → node **positions are restored** from `graph`.
3. Run `process-pending` against a seeded item → SMS sends exactly as before
   (engine unaffected).
4. Open one of the **existing graph-less** automations → auto-layout renders the 4
   nodes; edit + save backfills `graph`; behavior unchanged.
5. Repeat 1–4 for the Sheets path if shipping v1 with Sheets.

---

## Open Prerequisite (blocking implementation)

AiroPhone currently exposes **only one Supabase project** in the provided envs —
`sebaeihdyfhbkqmmrjbh` (**production**). The "TEST first" rule requires a separate
TEST/staging AiroPhone Supabase. **Resolve before applying the migration:** use an
existing test project (provide creds), create a new test project, or validate against
a local Postgres mirror.

---

## Non-Goals (explicitly out of scope)

- No condition/branch node; no if/else logic.
- No repeats / multi-step sequences (that is the future "Option B" upgrade).
- No voicemail / call / WhatsApp / tag nodes.
- No new trigger sources.
- No change to the execution engine or existing scheduling behavior.
