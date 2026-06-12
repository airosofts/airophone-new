-- MMS support: store media (image/video) attachments on a message.
-- media_urls is a JSON array of { url, type } objects (type = MIME, e.g. image/jpeg).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_urls jsonb;
