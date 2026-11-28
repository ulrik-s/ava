-- kind: contract
-- #2192: contract-steget efter #2180 (expand, migration 0054 i v0.7.70). Varje
-- uppgift får en källa:
--   - acontofakturans nedbrytning bara i acconto_breakdown. Acontofakturor med
--     settlement_breakdown (skrivna av kod från före 0054, t.ex. efter en
--     rollback) får den flyttad, och settlement_breakdown nollas i SAMMA UPDATE,
--     så att ingen nedbrytning går förlorad;
--   - förordnandemålets avslut bara i billing_runs.forordnande_avslut. Körningar
--     som saknar det får det ur anteckningen med samma mönster som 0054.
-- Idempotent. Ändrade rader får ny version + en change_log-rad (som 0054), så
-- att klienternas cache hämtar dem igen vid nästa pull.
--
-- `contract`, fast ingen sats är destruktiv: kod från före 0054 läser bara
-- settlement_breakdown och skulle visa aconton utan nedbrytning. En manuell
-- rollback till v0.7.70 eller senare är säker (den läser acconto_breakdown först).

WITH changed AS (
  UPDATE invoices SET acconto_breakdown = COALESCE(acconto_breakdown, settlement_breakdown),
    settlement_breakdown = NULL, version = version + 1, updated_at = now()
  WHERE invoice_type = 'ACCONTO' AND settlement_breakdown IS NOT NULL
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
