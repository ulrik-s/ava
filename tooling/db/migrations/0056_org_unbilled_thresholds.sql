-- kind: expand
-- #1911: byråns trösklar för "Bör faktureras" i Frister (belopp i öre och ålder
-- i dagar). NULL = kodens standard (DEFAULT_UNBILLED_THRESHOLD_ORE,
-- DEFAULT_UNBILLED_AGE_DAYS i src/lib/shared/watchlist.ts).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS unbilled_threshold_ore integer;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS unbilled_age_days integer;
