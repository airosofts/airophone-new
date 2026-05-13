-- The inbox ContactPanel.js historically stored contacts.custom_fields as an
-- array of {id, label, type, value} while every other code path used the
-- canonical object format {key: value}. The array shape silently broke
-- {{token}} substitution in AI scenarios.
--
-- Normalize all existing array-format rows to {slug(label): value}.
--
-- Idempotent: only touches rows where custom_fields is currently an array.

UPDATE contacts
SET custom_fields = (
  SELECT jsonb_object_agg(
    -- Slugify the label: lowercase, replace non-alphanumerics with _
    regexp_replace(lower(coalesce(elem ->> 'label', '')), '[^a-z0-9]+', '_', 'g'),
    elem -> 'value'
  )
  FROM jsonb_array_elements(custom_fields) AS elem
  WHERE coalesce(elem ->> 'label', '') <> ''
)
WHERE jsonb_typeof(custom_fields) = 'array'
  AND custom_fields IS NOT NULL;
