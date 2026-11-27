-- kind: expand
-- #2180: två uppgifter som låg i fel kolumn får egna, typade kolumner.
--
-- billing_runs.forordnande_avslut: hur förundersökningen i ett förordnandemål
-- avslutades (NEDLAGD, STRAFFORELAGGANDE, INGET_ATAL; zod-enumen
-- forordnandeAvslutSchema). Förut fanns avslutet bara som en rad i körningens
-- anteckning ("Förordnandetaxa – förundersökningen lades ned", #2082). Ingen
-- CHECK (den vore en contract); zod vaktar värdena.
--
-- invoices.acconto_breakdown: acontofakturans nedbrytning (#2147), som hittills
-- delade settlement_breakdown med slutfakturans.
--
-- Backfill, idempotent (bara rader där den nya kolumnen är null):
--   - acontofakturor (invoice_type = 'ACCONTO') med en nedbrytning får den
--     kopierad till acconto_breakdown;
--   - kostnadsräkningar vars anteckning slutar med förordnandetaxans rad får
--     avslutet ur den.
-- Ändrade rader får ny version + en change_log-rad (som 0051), så att
-- klienternas cache hämtar dem igen vid nästa pull.
--
-- Additivt: äldre kod läser och skriver settlement_breakdown och anteckningen
-- som förut, och den nya koden skriver fortfarande båda (expand). Att sluta
-- skriva de gamla är ett senare contract-steg.

ALTER TABLE billing_runs ADD COLUMN IF NOT EXISTS forordnande_avslut text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS acconto_breakdown jsonb;

WITH changed AS (
  UPDATE invoices SET acconto_breakdown = settlement_breakdown, version = version + 1, updated_at = now()
  WHERE invoice_type = 'ACCONTO' AND settlement_breakdown IS NOT NULL AND acconto_breakdown IS NULL
  RETURNING id, matter_id, version, deleted_at
)
INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT m.organization_id, 'invoice', c.id, c.version, 'update'
FROM changed c JOIN matters m ON m.id = c.matter_id
WHERE c.deleted_at IS NULL;

WITH parsed AS (
  SELECT id, CASE
    WHEN notes ~ '(^|\n)Förordnandetaxa – förundersökningen lades ned$' THEN 'NEDLAGD'
    WHEN notes ~ '(^|\n)Förordnandetaxa – strafföreläggande godkändes$' THEN 'STRAFFORELAGGANDE'
    WHEN notes ~ '(^|\n)Förordnandetaxa – förundersökningen avslutades utan åtal$' THEN 'INGET_ATAL'
  END AS avslut
  FROM billing_runs
  WHERE type = 'KOSTNADSRAKNING' AND forordnande_avslut IS NULL AND notes IS NOT NULL
), changed AS (
  UPDATE billing_runs b SET forordnande_avslut = p.avslut, version = b.version + 1, updated_at = now()
  FROM parsed p
  WHERE b.id = p.id AND p.avslut IS NOT NULL
  RETURNING b.id, b.matter_id, b.version, b.deleted_at
)
INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT m.organization_id, 'billingRun', c.id, c.version, 'update'
FROM changed c JOIN matters m ON m.id = c.matter_id
WHERE c.deleted_at IS NULL;
