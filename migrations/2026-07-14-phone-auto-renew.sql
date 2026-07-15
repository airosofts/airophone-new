-- Auto-recharge to keep phone numbers.
--
-- When the monthly phone-number renewal (100 credits/number) can't be paid from
-- the credit wallet, instead of recycling the number the billing job now charges
-- the workspace's default card to top the wallet up, then renews. This flag lets
-- a workspace turn that off. Default ON — losing a number over one short month is
-- worse than an auto-charge (and it only ever charges when a card is on file).
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS phone_auto_renew boolean NOT NULL DEFAULT true;
