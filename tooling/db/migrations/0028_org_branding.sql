-- #1218: byråns webbplats, logga och sidfotsmärke på kostnadsräkningen.
--
-- Bilderna lagras som data-URL (PNG/JPEG, ≤ 300 kB) direkt på raden — små,
-- byråunika och följer med i synken utan ett separat blob-lager. Formen och
-- storleksgränsen ägs av zod-schemat `orgImageSchema`.
--
-- `logo_path` tas bort: den skrevs aldrig (ingen uppladdning pekade dit) och
-- ersätts av `logo`.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS logo text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS footer_seal text;
ALTER TABLE organizations DROP COLUMN IF EXISTS logo_path;
