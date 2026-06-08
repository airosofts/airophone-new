-- Carrier / line-type caching for the RVM landline scrub.
-- Populated by Telnyx Number Lookup. Cached on the contact so we never pay to
-- look up the same number twice.
--   line_type: 'mobile' | 'voip' | 'landline' | 'unknown' | NULL (never checked)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS line_type text;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS line_type_checked_at timestamptz;
