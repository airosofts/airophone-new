-- Ringless Voicemail (RVM) feature — sends voice messages via VoiceDrop.ai
--
-- Adds:
--   • messages.type / recording_url / duration_seconds  (so chat window can render voicemails)
--   • phone_numbers.voicedrop_verified                  (track which numbers VoiceDrop has accepted as senders)
--   • voicemail_campaigns table                         (mirror of campaigns but for RVM)
--   • Storage bucket "voicemails"                       (public-read audio files VoiceDrop pulls from)

-- ─── messages: support voicemail rows ──────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS type             text DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS recording_url    text,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- ─── phone_numbers: track VoiceDrop verification per sender number ─────────
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS voicedrop_verified    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicedrop_verified_at timestamptz;

-- ─── voicemail_campaigns ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voicemail_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  name                text NOT NULL,
  recording_url       text NOT NULL,
  recording_path      text,                                -- supabase storage path (for cleanup on delete)
  sender_number       text NOT NULL,                       -- e.g. "+13203158316"
  contact_list_ids    uuid[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'draft',       -- draft / running / completed / failed / paused
  sent_count          integer DEFAULT 0,
  failed_count        integer DEFAULT 0,
  delivered_count     integer DEFAULT 0,
  created_at          timestamptz DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voicemail_campaigns_workspace ON voicemail_campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_voicemail_campaigns_status    ON voicemail_campaigns(status);

-- ─── Storage bucket for audio uploads ──────────────────────────────────────
-- Public-read so VoiceDrop can fetch the .mp3 via the URL we send them.
INSERT INTO storage.buckets (id, name, public)
VALUES ('voicemails', 'voicemails', true)
ON CONFLICT (id) DO NOTHING;

-- ─── Backfill existing messages so type is never NULL ──────────────────────
UPDATE messages SET type = 'sms' WHERE type IS NULL;
