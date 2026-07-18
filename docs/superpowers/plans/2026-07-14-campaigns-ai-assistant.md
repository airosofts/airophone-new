# Campaigns AI Assistant — Implementation Plan

> Build an AI chat assistant to set up SMS campaigns, mirroring the AI-scenario builder's **hybrid** pattern (LLM writes text; app-owned deterministic widget queue). The **model picker is the FIRST step** (not last, as in scenarios). The existing manual wizard stays fully intact. **No Review phase** — after the last question the assistant creates the campaign draft and routes to the list.

**Goal:** A "Build with AI" path on Campaigns that, through chat, drafts the SMS message and collects sender/audience/filter/schedule/pace, then creates a draft campaign via the SAME backend the manual flow uses. Zero backend/DB changes to the campaign engine.

**Constraint (do NOT change):** the AI-scenario builder (`ScenarioAgentChat.js`, `scenarios/builder-chat`) is untouched — we clone its pattern into new campaign files.

## Architecture

- **Reuse as-is:** `src/lib/ai-models.js` (`listModels`, `getAIReply`, `AI_MODELS`), `GET /api/ai-models`, all campaign endpoints (`POST /api/campaigns`, `[id]/monday-link`, `[id]/sheets-link`, `[id]/start`, `preview-recipients`), and every data endpoint the manual wizard uses (`/api/phone-numbers`, `/api/contact-lists`, `/api/integrations/monday/boards[/[id]/columns]`, `/api/integrations/google-sheets/*`).
- **New files:**
  1. `src/app/api/campaigns/builder-chat/route.js` — the LLM message-writer (clone of the scenarios one; authors `{reply, name, message, settings}` using the **user-picked model**; validates every extracted setting).
  2. `src/components/campaigns/CampaignAgentChat.js` — the chat UI: model-pick-first → describe/draft → deterministic widget queue → create (no review).
  3. `src/app/(dashboard)/campaigns/new/page.js` — full-page host for the assistant, with a "Set up manually" link back to the list's existing modal.
  4. Entry: a "Build with AI" button on the campaigns list header → `/campaigns/new`. Manual "New Campaign" modal unchanged.

## Data contracts (verified against the real code)

- `POST /api/campaigns` body: `{ name, message_template, sender_number, source, contact_list_ids, scheduled_at, daily_cap, recurring, recipient_filters, draft }` → `{ campaign: { id, ... } }`. `sender_number` is the **phone-number string** (map from the picked phone id). `source` ∈ `contacts|monday|sheets`. Always inserts `status:'draft'`.
- `POST /api/campaigns/[id]/monday-link` body: `{ board_id, board_name, group_ids, item_ids, phone_column_id }` (board_id + phone_column_id required; empty arrays = "all").
- `POST /api/campaigns/[id]/sheets-link` body: `{ spreadsheet_id, spreadsheet_name, sheet_id, sheet_name, phone_column, row_ids }` (spreadsheet_id + sheet_name + phone_column required; empty row_ids = "all").
- `recipient_filters` jsonb: `{ engagement: 'all'|'not_replied'|'not_replied_recent'|'replied'|'never_messaged', window_hours, skip_contacted_hours, exclude_statuses }`.

## The queue (slots the assistant collects, in order)

0. **AI model** (FIRST) — from `listModels()`; powers the chat + message drafting.
1. **Message + name** — LLM-drafted from the user's description (editable).
2. **Sender line** — pick a workspace phone number (→ `sender_number` string).
3. **Audience source** — contacts / monday / sheets, then the source pickers:
   - contacts → contact list (from `/api/contact-lists`)
   - monday → board + phone column (all groups/items)
   - sheets → spreadsheet + tab + phone column (all rows)
4. **Engagement filter** (contacts only) — everyone / haven't replied / quiet for N / brand-new.
5. **Schedule** — send now / pick a time (`scheduled_at`).
6. **Pace** — daily cap (off/number), business-hours-only, recurring (needs a cap).
→ **Create** the draft (+ source link) and route to `/campaigns` (no review card).

## Tasks

- **Task 1 — builder-chat route.** New `src/app/api/campaigns/builder-chat/route.js`. System prompt for outbound SMS copy; author via picked model (OpenAI→JSON mode; Claude/Gemini→`getAIReply` + JSON parse; fallback gpt-4o). Return `{success, reply, name, message, settings}`; validate settings (sender id, source, list ids, engagement) against real workspace ids.
- **Task 2 — CampaignAgentChat component.** New `src/components/campaigns/CampaignAgentChat.js`. Implements the phases + widget queue + create. Loads data lazily per source. Maps picked phone id → `sender_number`. Assembles the create payload, POSTs `/api/campaigns`, then `monday-link`/`sheets-link` if needed, then `router.push('/campaigns')`.
- **Task 3 — /campaigns/new page.** New `src/app/(dashboard)/campaigns/new/page.js` renders the assistant full-page with a "Set up manually" link.
- **Task 4 — entry button.** Add "Build with AI" to the campaigns list header linking to `/campaigns/new`. Manual modal untouched.

## Verification

App can't `next build` (deps incomplete); verify with a JSX-aware syntax parse of all new/changed files. Runtime test requires `npm install` finished + provider API keys + Google/Monday connected + the cron running.
