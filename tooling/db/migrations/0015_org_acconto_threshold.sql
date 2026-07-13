-- #885: gränsbelopp (öre) för klientens självrisk innan ett aconto skickas.
-- NULL = använd default (SJALVRISK_ACCONTO_THRESHOLD_ORE, 150000).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS acconto_threshold_ore integer;
