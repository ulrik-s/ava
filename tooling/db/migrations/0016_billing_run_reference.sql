-- #889: kostnadsräkningens referensnummer (KR-YYYY-NNNN) — visas i
-- faktureringslistan i samma format som fakturornas F-nummer.
ALTER TABLE billing_runs ADD COLUMN IF NOT EXISTS reference text;
