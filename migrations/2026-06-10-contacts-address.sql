ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS address text;
