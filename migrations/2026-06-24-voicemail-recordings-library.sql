-- Audio Library for RVM: saved, reusable voicemail recordings per workspace.
--
-- Today every RVM campaign re-uploads its audio. This table lets a workspace
-- keep a library of recordings (uploaded or recorded in-app) and pick one when
-- creating a new campaign — no re-upload.
--
-- We store BOTH the Supabase storage path (for in-app playback — re-signed on
-- read since signed URLs expire) and VoiceDrop's permanent S3 URL (what the
-- sender actually fetches). voicedrop_url is the one that matters for sending.
CREATE TABLE IF NOT EXISTS public.voicemail_recordings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  created_by      uuid,
  name            text NOT NULL,
  storage_path    text,                 -- Supabase storage path (voicemails bucket) for playback
  playback_url    text,                 -- last signed playback URL (re-signed from storage_path on read)
  voicedrop_url   text,                 -- VoiceDrop S3 permanent URL — used as recording_url when sending
  duration_seconds int,
  size_bytes      int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voicemail_recordings_workspace
  ON public.voicemail_recordings (workspace_id, created_at DESC);

-- Refresh PostgREST's schema cache so the new table is queryable immediately.
NOTIFY pgrst, 'reload schema';
