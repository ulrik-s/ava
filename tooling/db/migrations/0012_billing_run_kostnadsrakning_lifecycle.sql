-- #828: kostnadsräkningens egen livscykel på billing_runs. KR-status
-- (INSKICKAD/BESLUTAD/OVERKLAGAD/FAKTURERAD), domstolens dömda belopp, och om
-- beslutet är slutgiltigt (efter hovrättens beslut → får ej överklagas igen).
ALTER TABLE billing_runs ADD COLUMN IF NOT EXISTS kostnadsrakning_status text;
ALTER TABLE billing_runs ADD COLUMN IF NOT EXISTS awarded_ore integer;
ALTER TABLE billing_runs ADD COLUMN IF NOT EXISTS beslut_slutgiltigt boolean NOT NULL DEFAULT false;
