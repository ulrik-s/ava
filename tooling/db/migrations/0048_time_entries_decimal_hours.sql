-- #1546: engångsomräkning av ej fakturerad tid till tillåtna decimaltimmar.
--
-- Tid registreras sedan #1544 i 6-minutersintervall plus kvartar: hela timmar
-- plus 0, 6, 12, 15, 18, 24, 30, 36, 42, 45, 48 eller 54 minuter. Äldre poster
-- kan ha andra värden (t.ex. 37 min). De räknas om EN gång till närmaste
-- tillåtna värde, med samma regel som `roundToAllowedMinutes`
-- (src/lib/shared/time-hours.ts): lika avstånd avrundas uppåt (9 → 12,
-- 57 → 60), tid över 0 blir aldrig 0 utan minst 6, och 0 förblir 0.
--
-- Bara poster som inte är fakturerade, frysta eller raderade ändras, och inte
-- per-dygnsposter (ADVOKATBEREDSKAP, där minuterna inte används). Fakturor,
-- kostnadsräkningar (billing_runs), sparade specifikationer och bokföring rörs
-- inte (ADR 0015). Minuterna är fortfarande heltal, så äldre kod fungerar.
--
-- Ändrade poster får ny version + en change_log-rad (som 0025), så att
-- klienternas cache hämtar dem vid nästa pull (ADR 0017). time_entries saknar
-- egen organisation: den tas via ärendet. Idempotent: en andra körning hittar
-- inga otillåtna värden och ändrar ingenting.

WITH target AS (
  SELECT te.id, m.organization_id,
    GREATEST(6, (te.minutes / 60) * 60 + (
      SELECT a FROM unnest(ARRAY[0, 6, 12, 15, 18, 24, 30, 36, 42, 45, 48, 54, 60]) AS a
      ORDER BY abs(a - te.minutes % 60), a DESC
      LIMIT 1
    )) AS rounded
  FROM time_entries te
  JOIN matters m ON m.id = te.matter_id
  WHERE te.minutes > 0
    AND te.minutes % 60 NOT IN (0, 6, 12, 15, 18, 24, 30, 36, 42, 45, 48, 54)
    AND te.frozen_by_billing_run_id IS NULL
    AND te.invoice_id IS NULL
    AND te.frozen_at IS NULL
    AND te.deleted_at IS NULL
    AND te.kind IS DISTINCT FROM 'ADVOKATBEREDSKAP'
), updated AS (
  UPDATE time_entries te
  SET minutes = t.rounded, version = te.version + 1, updated_at = now()
  FROM target t
  WHERE te.id = t.id
  RETURNING te.id, te.version, t.organization_id
)
INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT organization_id, 'timeEntry', id, version, 'update' FROM updated;
