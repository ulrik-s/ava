-- #1173: inbetalningar bokförs som egna verifikat i Fortnox (bank D /
-- kundfordran K). Kolumnen håller verifikatet ("A/13"); satt = bokförd, så en
-- omkörning aldrig bokför samma betalning två gånger.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fortnox_id text;
