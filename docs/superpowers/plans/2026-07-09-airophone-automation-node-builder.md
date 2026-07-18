# AiroPhone Automations — Drag-and-Drop Node Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AiroPhone's fixed 4-card automation editor with a React-Flow drag-and-drop canvas of the same 4 blocks (one of each, wired in a line), persisting node positions in one new nullable `graph` jsonb column — without changing the automation's behavior or execution engine.

**Architecture:** Pure mapping functions convert between a saved automation row and a React-Flow `{nodes, edges}` graph. The builder renders 4 custom nodes on a `@xyflow/react` canvas; on save it flattens the graph back to today's exact columns (engine untouched) and also writes the raw graph to the new column. Loading renders from `graph`, or auto-lays-out the 4 nodes from the flat columns for pre-existing automations.

**Tech Stack:** Next.js 16, React 19, `@xyflow/react` (React Flow), Supabase (Postgres), `node --test` for unit tests, psql for the TEST-DB work.

## Global Constraints

- Work **only** on branch `omar-flexibleAutomation`. Never push. Never modify other branches.
- **No new trigger types, no condition/branch node, no new actions.** Only the 4 existing blocks: Trigger, When-to-send (Wait), Send-a-text, Sync-back.
- **One instance of each node**, linear wiring. Trigger + Send required; When-to-send + Sync optional.
- The execution engine (`process-pending`), the existing flat columns, and existing rows are **unchanged**. Only additive work.
- **Exactly one schema change:** a nullable `graph jsonb` column on `monday_automations` and `sheets_automations`.
- **All DB testing is against the TEST project `airophone-test` (`sayakmjcwleakvxzuujw`).** Production (`sebaeihdyfhbkqmmrjbh`) is never written. TEST creds live at `<scratchpad>/airophone-test.env`.
- Styling uses AiroPhone's palette (from `AutomationBuilder.js`): trigger `#6161FF`, send `#D63B1F`, timing `#2563EB`, sync `#16A34A`. 4px-radius cards, colored headers.
- The Monday create path registers a webhook requiring a public URL — it **cannot** be exercised on localhost. Testing is at the pure-function + DB-round-trip level (see Task 6).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `_e2e_automation/rebuild-test-schema.sql` (scratch) | DDL to stand up the automation tables + `graph` column on `airophone-test` | Create (scratch, not committed) |
| `migrations/2026-07-09-automation-graph-column.sql` | The repo migration adding `graph` to both automation tables | Create |
| `src/lib/automation-graph/index.js` | Pure map: `buildGraphFromAutomation`, `flattenGraphToPayload`, `validateGraph`, node-type constants | Create |
| `src/lib/automation-graph/package.json` | `{"type":"module"}` ESM island so `node --test` runs the `.js` | Create |
| `src/lib/automation-graph/index.test.js` | Unit tests for the pure map | Create |
| `src/components/automations/AutomationNodes.js` | 4 React-Flow custom node components + `nodeTypes` | Create |
| `src/app/(dashboard)/automations/AutomationBuilder.js` | Swap the static 4-card layout for the React-Flow canvas; wire load/save through the pure map | Modify |
| `src/app/api/automations/route.js` | Accept + persist `graph` on POST (Monday + Sheets) | Modify |
| `src/app/api/automations/[id]/route.js` | Accept + persist `graph` on PATCH (Monday + Sheets) | Modify |
| `_e2e_automation/graph-roundtrip.mjs` (scratch) | DB round-trip test against `airophone-test` | Create (scratch) |

---

## Task 0: Stand up the automation schema on `airophone-test`

**Files:**
- Create (scratch): `airophone-new/_e2e_automation/rebuild-test-schema.sql`

**Interfaces:**
- Produces: tables `monday_automations`, `sheets_automations`, `monday_writeback_configs`, `sheets_writeback_configs`, `monday_automation_sends` on `airophone-test`, each automation table carrying a nullable `graph jsonb`. Columns match production (read earlier via the REST OpenAPI). No FK enforcement — these are standalone for graph-persistence + column-mapping tests.

- [ ] **Step 1: Write the DDL** — `airophone-new/_e2e_automation/rebuild-test-schema.sql`:

```sql
create extension if not exists pgcrypto;

create table if not exists public.monday_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, name text, board_id text, board_name text,
  trigger_event text, monday_webhook_id text, phone_column_id text,
  message_mode text, message_template text, ai_instructions text,
  sender_phone_number_id text, is_active boolean default true,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  send_delay_seconds int default 0, respect_business_hours boolean default false,
  business_hours_mode text default 'anytime',
  graph jsonb
);

create table if not exists public.sheets_automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, name text, spreadsheet_id text, spreadsheet_name text,
  sheet_id bigint, sheet_name text, trigger_event text default 'new_row',
  phone_column text, message_mode text, message_template text, ai_instructions text,
  sender_phone_number_id text, send_delay_seconds int default 0,
  business_hours_mode text default 'anytime', is_active boolean default true,
  last_polled_at timestamptz, created_by uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  graph jsonb
);

create table if not exists public.monday_writeback_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, board_id text, board_name text,
  on_sent_column_id text, on_sent_column_type text, on_sent_value jsonb,
  on_reply_column_id text, on_reply_column_type text, on_reply_value jsonb,
  on_done_column_id text, on_done_column_type text, on_done_value jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.sheets_writeback_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid, spreadsheet_id text, sheet_id bigint, sheet_name text,
  on_sent_column text, on_sent_value text,
  on_reply_column text, on_reply_value text,
  on_done_column text, on_done_value text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.monday_automation_sends (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid, monday_item_id text, conversation_id uuid, message_id uuid,
  status text, detail text, created_at timestamptz default now(), scheduled_at timestamptz
);
```

- [ ] **Step 2: Apply it to `airophone-test`**

Run (Git Bash / PowerShell):
```
psql "postgresql://postgres:Omar57faiz%40@db.sayakmjcwleakvxzuujw.supabase.co:5432/postgres?sslmode=require" < airophone-new/_e2e_automation/rebuild-test-schema.sql
```
Expected: `CREATE EXTENSION` then a series of `CREATE TABLE`. Re-running is a no-op (`if not exists`).

- [ ] **Step 3: Verify the `graph` column exists**

Pipe this SQL to the same connection:
```sql
select table_name, column_name from information_schema.columns
where table_name in ('monday_automations','sheets_automations') and column_name='graph';
```
Expected: two rows (`monday_automations|graph`, `sheets_automations|graph`).

- [ ] **Step 4: Commit** (the scratch SQL documents how TEST was built)

```bash
git add airophone-new/_e2e_automation/rebuild-test-schema.sql
git commit -m "test: rebuild automation schema subset on airophone-test"
```

---

## Task 1: Repo migration for the `graph` column

**Files:**
- Create: `airophone-new/migrations/2026-07-09-automation-graph-column.sql`

**Interfaces:**
- Produces: the production-ready migration (applied to prod later, by the user, out of scope here).

- [ ] **Step 1: Write the migration**

```sql
-- Adds the React-Flow visual graph to board/sheet automations.
-- Additive + nullable: the execution engine never reads it; existing rows are unaffected.
alter table public.monday_automations add column if not exists graph jsonb;
alter table public.sheets_automations  add column if not exists graph jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add airophone-new/migrations/2026-07-09-automation-graph-column.sql
git commit -m "feat: add graph jsonb column migration for automation node builder"
```

---

## Task 2: Pure mapping functions + unit tests

**Files:**
- Create: `src/lib/automation-graph/index.js`
- Create: `src/lib/automation-graph/package.json`
- Test: `src/lib/automation-graph/index.test.js`

**Interfaces:**
- Produces:
  - `NODE = { TRIGGER:'trigger', WAIT:'wait', SEND:'send', SYNC:'sync' }`
  - `buildGraphFromAutomation(automation)` → `{ nodes:[{id,type,position:{x,y},data}], edges:[{id,source,target}] }`. If `automation.graph?.nodes?.length` it is returned as-is; otherwise the 4 nodes are synthesized from the flat columns and auto-laid-out.
  - `flattenGraphToPayload(graph, source)` → a plain object of the existing columns for that `source` (`'monday'|'sheets'`) plus `graph`. Sync node (if present) is returned under `graph.data` only (writeback is a separate table, handled by the builder's existing writeback call — this function does not touch writeback).
  - `validateGraph(graph, source)` → `string[]` of human-readable errors (empty = valid).

- [ ] **Step 1: Write the ESM-island package.json** — `src/lib/automation-graph/package.json`:

```json
{ "type": "module" }
```

- [ ] **Step 2: Write the failing tests** — `src/lib/automation-graph/index.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NODE, buildGraphFromAutomation, flattenGraphToPayload, validateGraph } from './index.js'

test('buildGraphFromAutomation: returns stored graph verbatim when present', () => {
  const stored = { nodes: [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 1, y: 2 }, data: {} }], edges: [] }
  const g = buildGraphFromAutomation({ graph: stored })
  assert.deepEqual(g, stored)
})

test('buildGraphFromAutomation: synthesizes 4 nodes from flat monday columns when no graph', () => {
  const g = buildGraphFromAutomation({
    board_id: 'b1', board_name: 'Leads', trigger_event: 'create_item', phone_column_id: 'phone',
    send_delay_seconds: 600, business_hours_mode: 'within',
    sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi {{name}}',
  })
  const types = g.nodes.map(n => n.type)
  assert.ok(types.includes(NODE.TRIGGER))
  assert.ok(types.includes(NODE.WAIT))
  assert.ok(types.includes(NODE.SEND))
  // every node has a finite position
  assert.ok(g.nodes.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)))
  // edges connect them in a line, trigger first
  assert.equal(g.edges[0].source, 'trigger')
})

test('flattenGraphToPayload: maps monday nodes back to existing columns + graph', () => {
  const graph = {
    nodes: [
      { id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: { board_id: 'b1', board_name: 'Leads', trigger_event: 'create_item', phone_column_id: 'phone' } },
      { id: 'wait', type: NODE.WAIT, position: { x: 1, y: 0 }, data: { send_delay_seconds: 600, business_hours_mode: 'within' } },
      { id: 'send', type: NODE.SEND, position: { x: 2, y: 0 }, data: { sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi' } },
    ],
    edges: [],
  }
  const p = flattenGraphToPayload(graph, 'monday')
  assert.equal(p.board_id, 'b1')
  assert.equal(p.trigger_event, 'create_item')
  assert.equal(p.phone_column_id, 'phone')
  assert.equal(p.send_delay_seconds, 600)
  assert.equal(p.business_hours_mode, 'within')
  assert.equal(p.message_mode, 'template')
  assert.equal(p.message_template, 'Hi')
  assert.equal(p.graph, graph)
})

test('validateGraph: flags a missing send node', () => {
  const graph = { nodes: [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: { board_id: 'b1', trigger_event: 'create_item', phone_column_id: 'p' } }], edges: [] }
  const errors = validateGraph(graph, 'monday')
  assert.ok(errors.some(e => /send/i.test(e)))
})

test('validateGraph: passes a complete monday graph', () => {
  const graph = { nodes: [
    { id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: { board_id: 'b1', trigger_event: 'create_item', phone_column_id: 'p' } },
    { id: 'send', type: NODE.SEND, position: { x: 1, y: 0 }, data: { sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi' } },
  ], edges: [] }
  assert.deepEqual(validateGraph(graph, 'monday'), [])
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd airophone-new && node --test src/lib/automation-graph/*.test.js`
Expected: FAIL — `Cannot find module './index.js'` / functions undefined.

- [ ] **Step 4: Write the implementation** — `src/lib/automation-graph/index.js`:

```js
// Pure mapping between an automation row and a React-Flow {nodes, edges} graph.
// No React, no DB — safe to import from both client components and node --test.

export const NODE = { TRIGGER: 'trigger', WAIT: 'wait', SEND: 'send', SYNC: 'sync' }

const COL = 300, ROW = 60

// Build a canvas graph for an automation. Prefer the stored graph; otherwise
// synthesize the 4 nodes (trigger, wait, send, [sync]) from the flat columns
// and lay them out left-to-right so pre-existing automations still render.
export function buildGraphFromAutomation(automation = {}) {
  if (automation.graph && Array.isArray(automation.graph.nodes) && automation.graph.nodes.length) {
    return automation.graph
  }
  const isSheets = automation.source === 'sheets' || automation.spreadsheet_id != null
  const nodes = []
  nodes.push({
    id: 'trigger', type: NODE.TRIGGER, position: { x: 40, y: ROW },
    data: isSheets
      ? { spreadsheet_id: automation.spreadsheet_id, spreadsheet_name: automation.spreadsheet_name, sheet_id: automation.sheet_id, sheet_name: automation.sheet_name, phone_column: automation.phone_column }
      : { board_id: automation.board_id, board_name: automation.board_name, trigger_event: automation.trigger_event || 'create_item', phone_column_id: automation.phone_column_id },
  })
  nodes.push({
    id: 'wait', type: NODE.WAIT, position: { x: 40 + COL, y: ROW },
    data: { send_delay_seconds: automation.send_delay_seconds ?? 0, business_hours_mode: automation.business_hours_mode || 'anytime' },
  })
  nodes.push({
    id: 'send', type: NODE.SEND, position: { x: 40 + COL * 2, y: ROW },
    data: { sender_phone_number_id: automation.sender_phone_number_id, message_mode: automation.message_mode || 'template', message_template: automation.message_template || '', ai_instructions: automation.ai_instructions || '' },
  })
  const edges = [
    { id: 'e-trigger-wait', source: 'trigger', target: 'wait' },
    { id: 'e-wait-send', source: 'wait', target: 'send' },
  ]
  return { nodes, edges }
}

// Flatten a canvas graph to the existing columns for the given source.
// Returns { ...columns, graph } — the caller sends this straight to the API.
export function flattenGraphToPayload(graph, source = 'monday') {
  const byType = Object.fromEntries((graph.nodes || []).map(n => [n.type, n.data || {}]))
  const t = byType[NODE.TRIGGER] || {}
  const w = byType[NODE.WAIT] || {}
  const s = byType[NODE.SEND] || {}
  const common = {
    message_mode: s.message_mode || 'template',
    message_template: s.message_mode === 'ai' ? null : (s.message_template || ''),
    ai_instructions: s.message_mode === 'ai' ? (s.ai_instructions || '') : null,
    sender_phone_number_id: s.sender_phone_number_id,
    send_delay_seconds: Number(w.send_delay_seconds) || 0,
    business_hours_mode: ['anytime', 'within', 'outside'].includes(w.business_hours_mode) ? w.business_hours_mode : 'anytime',
    graph,
  }
  if (source === 'sheets') {
    return { ...common, source: 'sheets', spreadsheet_id: t.spreadsheet_id, spreadsheet_name: t.spreadsheet_name, sheet_id: t.sheet_id, sheet_name: t.sheet_name, phone_column: t.phone_column }
  }
  return { ...common, source: 'monday', board_id: t.board_id, board_name: t.board_name, trigger_event: t.trigger_event || 'create_item', phone_column_id: t.phone_column_id }
}

// Return a list of human-readable validation errors ([] = valid).
export function validateGraph(graph, source = 'monday') {
  const errors = []
  const byType = Object.fromEntries((graph.nodes || []).map(n => [n.type, n.data || {}]))
  const t = byType[NODE.TRIGGER]
  const s = byType[NODE.SEND]
  if (!t) errors.push('A Trigger block is required.')
  if (!s) errors.push('A Send-a-text block is required.')
  if (t) {
    if (source === 'sheets') {
      if (!t.spreadsheet_id) errors.push('Trigger: pick a spreadsheet.')
      if (!t.sheet_name) errors.push('Trigger: pick a sheet tab.')
      if (!t.phone_column) errors.push('Trigger: pick the phone column.')
    } else {
      if (!t.board_id) errors.push('Trigger: pick a Monday board.')
      if (!t.phone_column_id) errors.push('Trigger: pick the phone column.')
    }
  }
  if (s) {
    if (!s.sender_phone_number_id) errors.push('Send: pick a sender number.')
    if (s.message_mode === 'ai' ? !String(s.ai_instructions || '').trim() : !String(s.message_template || '').trim()) {
      errors.push('Send: the message is empty.')
    }
  }
  return errors
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd airophone-new && node --test src/lib/automation-graph/*.test.js`
Expected: PASS — all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/automation-graph/
git commit -m "feat: pure automation graph <-> columns mapping + tests"
```

---

## Task 3: The 4 React-Flow node components

**Files:**
- Create: `src/components/automations/AutomationNodes.js`

**Interfaces:**
- Consumes: `NODE` from `@/lib/automation-graph`; each node's `data.onChange(id, patch)`, `data.onDelete(id)`, and lookup arrays `data.boards`, `data.phoneNumbers`, `data.columns`.
- Produces: `nodeTypes = { trigger, wait, send, sync }` for `<ReactFlow nodeTypes={nodeTypes} />`.

- [ ] **Step 1: Install React Flow**

Run: `cd airophone-new && npm install @xyflow/react`
Expected: added to dependencies.

- [ ] **Step 2: Write the node components** — `src/components/automations/AutomationNodes.js`:

```js
'use client'
import { Handle, Position } from '@xyflow/react'

// AiroPhone palette (matches AutomationBuilder cards).
const C = {
  trigger: { line: '#6161FF', head: '#EEEEFF', text: '#4B4ACF' },
  wait:    { line: '#2563EB', head: '#EAF1FE', text: '#1D4ED8' },
  send:    { line: '#D63B1F', head: '#FDEDEA', text: '#B5301A' },
  sync:    { line: '#16A34A', head: '#E9F7EF', text: '#15803D' },
}
const W = 250
const card = (line) => ({ background: '#fff', border: `2px solid ${line}`, borderRadius: 4, width: W, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', fontSize: 12, color: '#1A1816', position: 'relative' })
const head = (c, label, icon) => (
  <div style={{ background: c.head, padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 6, borderTopLeftRadius: 2, borderTopRightRadius: 2 }}>
    <span>{icon}</span>
    <span style={{ fontWeight: 700, color: c.text, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</span>
  </div>
)
const lbl = { fontSize: 10, fontWeight: 700, color: '#737370', textTransform: 'uppercase', display: 'block', margin: '0 0 3px' }
const inp = { width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 4, border: '1px solid #E8E8E4', outline: 'none', boxSizing: 'border-box' }
const dot = (bg) => ({ width: 9, height: 9, background: bg, border: '2px solid #fff' })
const Del = ({ id, onDelete }) => onDelete ? (
  <button onClick={() => onDelete(id)} title="Remove block"
    style={{ position: 'absolute', top: -9, right: -9, width: 20, height: 20, borderRadius: '50%', border: 'none', background: '#D63B1F', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '20px', zIndex: 5 }}>&times;</button>
) : null

const TRIGGER_EVENTS = [['create_item', 'New item created'], ['change_column_value', 'Column changed'], ['move_item_to_group', 'Moved to group']]

export function TriggerNode({ id, data }) {
  const c = C.trigger
  const boards = data.boards || []
  const columns = data.columns || []
  return (
    <div style={card(c.line)}>
      {head(c, 'When this happens', '⚡')}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={lbl}>Monday board</label>
          <select className="nodrag" style={inp} value={data.board_id || ''} onChange={(e) => { const b = boards.find(x => String(x.id) === e.target.value); data.onChange(id, { board_id: e.target.value, board_name: b?.name || null }) }}>
            <option value="">Select a board…</option>
            {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Trigger</label>
          <select className="nodrag" style={inp} value={data.trigger_event || 'create_item'} onChange={(e) => data.onChange(id, { trigger_event: e.target.value })}>
            {TRIGGER_EVENTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Phone number column</label>
          <select className="nodrag" style={inp} value={data.phone_column_id || ''} onChange={(e) => data.onChange(id, { phone_column_id: e.target.value })} disabled={!data.board_id}>
            <option value="">{data.board_id ? 'Select a column…' : 'Pick a board first'}</option>
            {columns.map(col => <option key={col.id} value={col.id}>{col.title}</option>)}
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={dot(c.line)} />
    </div>
  )
}

export function WaitNode({ id, data }) {
  const c = C.wait
  return (
    <div style={card(c.line)}>
      <Del id={id} onDelete={data.onDelete} />
      <Handle type="target" position={Position.Left} style={dot(c.line)} />
      {head(c, 'When to send', '⏱')}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="nodrag" type="number" min="0" style={{ ...inp, width: 80 }}
            value={Math.floor((data.send_delay_seconds || 0) / (data._unitDivisor || 60))}
            onChange={(e) => data.onChange(id, { send_delay_seconds: Number(e.target.value) * (data._unitDivisor || 60) })} />
          <select className="nodrag" style={inp} value={String(data._unitDivisor || 60)}
            onChange={(e) => data.onChange(id, { _unitDivisor: Number(e.target.value) })}>
            <option value="60">Minutes</option>
            <option value="3600">Hours</option>
            <option value="86400">Days</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Business hours</label>
          <select className="nodrag" style={inp} value={data.business_hours_mode || 'anytime'} onChange={(e) => data.onChange(id, { business_hours_mode: e.target.value })}>
            <option value="anytime">Send any time</option>
            <option value="within">Only within business hours</option>
            <option value="outside">Only outside business hours</option>
          </select>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={dot(c.line)} />
    </div>
  )
}

export function SendNode({ id, data }) {
  const c = C.send
  const numbers = data.phoneNumbers || []
  const mode = data.message_mode || 'template'
  return (
    <div style={{ ...card(c.line), width: 290 }}>
      <Del id={id} onDelete={data.onDelete} />
      <Handle type="target" position={Position.Left} style={dot(c.line)} />
      {head(c, 'Send a text', '💬')}
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <label style={lbl}>Sender number</label>
          <select className="nodrag" style={inp} value={data.sender_phone_number_id || ''} onChange={(e) => data.onChange(id, { sender_phone_number_id: e.target.value })}>
            <option value="">Select a number…</option>
            {numbers.map(n => <option key={n.id} value={n.id}>{n.phone_number || n.number}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="nodrag" onClick={() => data.onChange(id, { message_mode: 'template' })}
            style={{ flex: 1, padding: '6px', borderRadius: 4, border: `1px solid ${mode === 'template' ? c.line : '#E8E8E4'}`, background: mode === 'template' ? c.head : '#fff', color: mode === 'template' ? c.text : '#737370', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>Template</button>
          <button className="nodrag" onClick={() => data.onChange(id, { message_mode: 'ai' })}
            style={{ flex: 1, padding: '6px', borderRadius: 4, border: `1px solid ${mode === 'ai' ? c.line : '#E8E8E4'}`, background: mode === 'ai' ? c.head : '#fff', color: mode === 'ai' ? c.text : '#737370', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>AI-written</button>
        </div>
        {mode === 'template' ? (
          <textarea className="nodrag" style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="Hi {{first_name}}, thanks for your interest!" value={data.message_template || ''} onChange={(e) => data.onChange(id, { message_template: e.target.value })} />
        ) : (
          <textarea className="nodrag" style={{ ...inp, minHeight: 70, resize: 'vertical' }} placeholder="Describe what the AI should say…" value={data.ai_instructions || ''} onChange={(e) => data.onChange(id, { ai_instructions: e.target.value })} />
        )}
      </div>
      <Handle type="source" position={Position.Right} style={dot(c.line)} />
    </div>
  )
}

export function SyncNode({ id, data }) {
  const c = C.sync
  return (
    <div style={card(c.line)}>
      <Del id={id} onDelete={data.onDelete} />
      <Handle type="target" position={Position.Left} style={dot(c.line)} />
      {head(c, 'Sync back to Monday', '🔁')}
      <div style={{ padding: '8px 10px', fontSize: 11, color: '#737370' }}>
        Two-way sync — configure the columns to update on sent / reply / done in the panel below the canvas.
      </div>
    </div>
  )
}

export const nodeTypes = { trigger: TriggerNode, wait: WaitNode, send: SendNode, sync: SyncNode }
```

- [ ] **Step 3: Verify it compiles** — Run: `cd airophone-new && npx next build --no-lint 2>&1 | tail -5` OR rely on the dev server compiling `/automations/new` without error in Task 4.
Expected: no import/JSX errors from `AutomationNodes.js`.

- [ ] **Step 4: Commit**

```bash
git add src/components/automations/AutomationNodes.js package.json package-lock.json
git commit -m "feat: React Flow custom node components for automation builder"
```

---

## Task 4: Swap the static layout for the React-Flow canvas

**Files:**
- Modify: `src/app/(dashboard)/automations/AutomationBuilder.js`

**Interfaces:**
- Consumes: `nodeTypes` from `@/components/automations/AutomationNodes`; `NODE, buildGraphFromAutomation, flattenGraphToPayload, validateGraph` from `@/lib/automation-graph`; React Flow hooks `ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState`.
- Preserves: the file's existing data-loading (boards, board columns, phone numbers, sheets) and its `onSubmit`/create+edit flow and the writeback ("Sync") panel. Read the current file first — reuse those loaders and the writeback editor verbatim; only the middle "canvas" region changes.

- [ ] **Step 1: Read the current file** to identify the data loaders and submit handler.

Run: open `src/app/(dashboard)/automations/AutomationBuilder.js`. Note the state holding `boards`, `columns`, `phoneNumbers`, and the function that POSTs/PATCHes to `/api/automations`.

- [ ] **Step 2: Replace the fixed 4-card render with the canvas.** Import at top:

```js
import { ReactFlow, Background, Controls, addEdge, useNodesState, useEdgesState } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from '@/components/automations/AutomationNodes'
import { NODE, buildGraphFromAutomation, flattenGraphToPayload, validateGraph } from '@/lib/automation-graph'
```

- [ ] **Step 3: Initialize canvas state from the automation (edit) or a fresh 3-node line (create).**

```js
const source = automation?.source || 'monday'
const initial = buildGraphFromAutomation(automation || {})
const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges)

const updateNodeData = (id, patch) => setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
const deleteNode = (id) => { setNodes(nds => nds.filter(n => n.id !== id)); setEdges(eds => eds.filter(e => e.source !== id && e.target !== id)) }
const onConnect = (p) => setEdges(eds => addEdge({ ...p, animated: true }, eds))

// Inject callbacks + lookups into every node's data on each render.
const rfNodes = nodes.map(n => ({ ...n, data: { ...n.data, onChange: updateNodeData, onDelete: n.type === NODE.TRIGGER ? undefined : deleteNode, boards, phoneNumbers, columns } }))
```

- [ ] **Step 4: Add-block palette (one-of-each).** A small toolbar over the canvas:

```js
const hasType = (t) => nodes.some(n => n.type === t)
const addNode = (type) => {
  if (hasType(type)) return
  const x = 40 + nodes.length * 300, y = 60
  const id = type
  const seed = type === NODE.WAIT ? { send_delay_seconds: 0, business_hours_mode: 'anytime' }
    : type === NODE.SYNC ? {} : {}
  setNodes(nds => [...nds, { id, type, position: { x, y }, data: seed }])
  const last = nodes[nodes.length - 1]
  if (last) setEdges(eds => addEdge({ id: `e-${last.id}-${id}`, source: last.id, target: id, animated: true }, eds))
}
```
Render buttons for Wait / Send / Sync, each disabled when `hasType(...)`.

- [ ] **Step 5: The canvas element** (replaces the old `<FlowCard>` row):

```jsx
<div style={{ height: 520, border: '1px solid #E8E8E4', borderRadius: 8, position: 'relative' }}>
  <ReactFlow nodes={rfNodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
    onConnect={onConnect} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
    <Background color="#E8E8E4" gap={22} />
    <Controls />
  </ReactFlow>
</div>
```

- [ ] **Step 6: Rewrite the submit handler to use the pure map.** In the existing create/update function, replace the hand-built body with:

```js
const graph = { nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data: stripCallbacks(data) })), edges: edges.map(({ id, source: s, target }) => ({ id, source: s, target })) }
const errors = validateGraph(graph, source)
if (errors.length) { setError(errors[0]); return }
const payload = { name, ...flattenGraphToPayload(graph, source) }
// keep the existing writeback save call exactly as it was (Sync panel)
// then: POST /api/automations (create) or PATCH /api/automations/[id] (edit) with `payload`
```
where `stripCallbacks = ({ onChange, onDelete, boards, phoneNumbers, columns, ...rest }) => rest`.

- [ ] **Step 7: Manually verify in the dev server (see Task 6 Step 1 for the TEST-env dev server).** Open `/automations/new`: the 3-node canvas renders (Trigger → When to send → Send a text); dragging moves nodes; "Add block → Sync" adds the 4th and disables further adds; removing Wait/Sync works; Trigger has no delete.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(dashboard)/automations/AutomationBuilder.js"
git commit -m "feat: drag-and-drop React Flow canvas replaces static automation cards"
```

---

## Task 5: Persist + return `graph` through the API

**Files:**
- Modify: `src/app/api/automations/route.js:191-214` (Monday insert), `:77-99` (Sheets insert)
- Modify: `src/app/api/automations/[id]/route.js` (both PATCH branches)

**Interfaces:**
- Consumes: `body.graph` (a `{nodes,edges}` object) from the builder payload.
- Produces: `graph` stored on insert/update. GET already returns it (`select('*')`).

- [ ] **Step 1: Monday POST — persist graph.** In `route.js` POST, destructure `graph` from `body` and add to the `monday_automations` insert object:

```js
const { name, board_id, /* … existing … */ business_hours_mode, graph } = body
// …in .insert({ … }) add:
graph: graph && typeof graph === 'object' ? graph : null,
```

- [ ] **Step 2: Sheets POST — persist graph.** In `createSheetsAutomation`, add `graph` to the destructure and the `sheets_automations` insert object the same way.

- [ ] **Step 3: PATCH — persist graph (both branches).** In `[id]/route.js`, in both the Monday `update` object and `patchSheetsAutomation`'s `update` object, add:

```js
if (body.graph && typeof body.graph === 'object') update.graph = body.graph
```

- [ ] **Step 4: Verify GET returns graph** — it already does (`select('*')`); no change. Confirm by reading `route.js` GET.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/automations/route.js "src/app/api/automations/[id]/route.js"
git commit -m "feat: persist and return automation graph through the API"
```

---

## Task 6: End-to-end round-trip test on `airophone-test`

**Files:**
- Create (scratch): `airophone-new/_e2e_automation/graph-roundtrip.mjs`

**Interfaces:**
- Consumes: `buildGraphFromAutomation`, `flattenGraphToPayload` from the lib; the `airophone-test` service-role key.
- Verifies: a graph written to `monday_automations.graph` reads back byte-identical; the flat columns are populated correctly; a graph-less row auto-lays-out to 3 nodes.

- [ ] **Step 1: Start a dev server pointed at `airophone-test`** (so the UI test in Task 4 Step 7 uses TEST, never prod):

Create `airophone-new/.env.test.local` (git-ignored) with the base prod env **but** the three Supabase lines swapped to TEST (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `<scratchpad>/airophone-test.env`). Then:
```
cd airophone-new
$env:NEXT_PUBLIC_SUPABASE_URL="https://sayakmjcwleakvxzuujw.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="<test service_role>"; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY="<test anon>"; npx next dev -p 3007
```
Expected: server on http://localhost:3007 using the TEST DB.

- [ ] **Step 2: Write the round-trip test** — `airophone-new/_e2e_automation/graph-roundtrip.mjs`:

```js
import { createClient } from '@supabase/supabase-js'
import { buildGraphFromAutomation, flattenGraphToPayload, NODE } from '../src/lib/automation-graph/index.js'

const url = 'https://sayakmjcwleakvxzuujw.supabase.co'
const key = process.env.TEST_SERVICE_ROLE // set from airophone-test.env before running
const sb = createClient(url, key)

const graph = {
  nodes: [
    { id: 'trigger', type: NODE.TRIGGER, position: { x: 40, y: 60 }, data: { board_id: 'b1', board_name: 'Leads', trigger_event: 'create_item', phone_column_id: 'phone' } },
    { id: 'wait', type: NODE.WAIT, position: { x: 340, y: 60 }, data: { send_delay_seconds: 600, business_hours_mode: 'within' } },
    { id: 'send', type: NODE.SEND, position: { x: 640, y: 60 }, data: { sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi {{name}}' } },
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'wait' }, { id: 'e2', source: 'wait', target: 'send' }],
}
const payload = flattenGraphToPayload(graph, 'monday')

const { data: row, error } = await sb.from('monday_automations').insert({
  name: 'e2e-graph', board_id: payload.board_id, board_name: payload.board_name,
  trigger_event: payload.trigger_event, phone_column_id: payload.phone_column_id,
  sender_phone_number_id: payload.sender_phone_number_id, message_mode: payload.message_mode,
  message_template: payload.message_template, send_delay_seconds: payload.send_delay_seconds,
  business_hours_mode: payload.business_hours_mode, graph: payload.graph,
}).select().single()
if (error) { console.error('INSERT FAILED', error); process.exit(1) }

const { data: back } = await sb.from('monday_automations').select('*').eq('id', row.id).single()
const ok1 = JSON.stringify(back.graph) === JSON.stringify(graph)
const ok2 = back.send_delay_seconds === 600 && back.business_hours_mode === 'within' && back.message_template === 'Hi {{name}}'
const rebuilt = buildGraphFromAutomation(back)
const ok3 = rebuilt.nodes.length === 3 && rebuilt.nodes[0].position.x === 40
const graphless = buildGraphFromAutomation({ board_id: 'b', trigger_event: 'create_item', phone_column_id: 'p', message_mode: 'template', message_template: 'x', sender_phone_number_id: 'n' })
const ok4 = graphless.nodes.length === 3 && graphless.nodes.every(n => Number.isFinite(n.position.x))

console.log('graph round-trips identical:', ok1)
console.log('flat columns correct:', ok2)
console.log('rebuild from stored graph:', ok3)
console.log('graph-less auto-layout:', ok4)

await sb.from('monday_automations').delete().eq('id', row.id) // cleanup
process.exit(ok1 && ok2 && ok3 && ok4 ? 0 : 1)
```

- [ ] **Step 3: Run it**

Run: `cd airophone-new && TEST_SERVICE_ROLE="<test service_role>" node _e2e_automation/graph-roundtrip.mjs`
Expected: four `true` lines, exit 0.

- [ ] **Step 4: Manual UI smoke (TEST dev server on :3007)** — Because the Monday webhook needs a public URL, do not click "Create" for a Monday automation on localhost (it will fail at webhook registration — expected, documented in the spec). Instead confirm: canvas renders, nodes drag, add/remove works, `validateGraph` blocks an empty Send (the create button surfaces the error). To confirm save+reload of positions end-to-end without a public webhook, seed a row via `graph-roundtrip.mjs` and open `/automations` → edit it → the nodes appear at the saved positions.

- [ ] **Step 5: Commit**

```bash
git add airophone-new/_e2e_automation/graph-roundtrip.mjs
git commit -m "test: graph round-trip + auto-layout on airophone-test"
```

---

## Self-Review

**Spec coverage:**
- Spec "4 nodes / one-of-each / wired in a line" → Tasks 3, 4 (palette caps duplicates; Trigger+Send seeded). ✅
- Spec "graph jsonb column, TEST first" → Tasks 0, 1, 5. ✅
- Spec "save flattens to existing columns + graph; engine unchanged" → Task 2 `flattenGraphToPayload`, Task 5. ✅
- Spec "load renders from graph, else auto-layout for existing rows" → Task 2 `buildGraphFromAutomation`, tested Task 6. ✅
- Spec "AiroPhone palette" → Task 3 `C` colors. ✅
- Spec "Sheets uses identical nodes" → mapping handles `source==='sheets'` (Task 2); UI focuses Monday first (Task 4), Sheets trigger fields already in the map. ✅
- Spec "GET-by-id or graph in list" → GET already `select('*')` returns graph; no new route needed (Task 5 Step 4). ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. Task 4 intentionally reuses the current file's data-loaders (documented as "read + preserve"), not a placeholder — the new canvas/submit code is given in full.

**Type consistency:** `NODE` constants (`trigger/wait/send/sync`) are used identically in the lib, node components (`nodeTypes` keys), and builder. `graph = {nodes, edges}` shape is consistent across map, API, and tests. `flattenGraphToPayload` returns `{...columns, graph, source}`, matching what the API destructures.

**Known limitation (documented, not a gap):** full "Create" of a Monday automation can't run on localhost (webhook needs public URL); Task 6 tests the graph/persistence/auto-layout at the DB + pure-function level instead, which is where all the new logic lives.
