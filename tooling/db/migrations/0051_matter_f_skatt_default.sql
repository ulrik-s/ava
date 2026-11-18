-- #1675: F-skatt är normen (alla advokater har F-skatt), och koden har alltid
-- antagit det (`taxaHasFTax ?? true`, kostnadsräkningen skickar true). Kolumnen
-- hade ändå DEFAULT false, och inget formulär sätter värdet, så varje ärende i
-- Postgres fick false utan att någon valt det. I LocalStore (undefined) blev
-- samma ärende "med F-skatt", i Postgres "utan".
--
-- Standardvärdet blir true, och befintliga false blir true. Ett uttryckligt
-- false går inte att skilja från standardvärdet, men inget gränssnitt har
-- kunnat sätta det. Ändrade rader får ny version + en change_log-rad, så att
-- klienternas cache hämtar dem igen vid nästa pull (som i 0025).
-- Bakåtkompatibelt: äldre kod läser `?? true` och får samma svar.

ALTER TABLE matters ALTER COLUMN taxa_has_f_tax SET DEFAULT true;

WITH changed AS (
  UPDATE matters SET taxa_has_f_tax = true, version = version + 1, updated_at = now()
  WHERE taxa_has_f_tax = false
  RETURNING organization_id, id, version, deleted_at
)
INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT organization_id, 'matter', id, version, 'update' FROM changed WHERE deleted_at IS NULL;
