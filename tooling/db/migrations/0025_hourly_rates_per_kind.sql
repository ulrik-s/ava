-- #1206: timpris per kategori med arv byrå → jurist → ärende.
--
-- Ersätter de spridda enkelpris-kolumnerna (0000/0023/0024) med EN karta per
-- entitet, `hourly_rates` (jsonb, öre/h per timbaserad kategori — nycklarna är
-- ARBETE, ARBETE_OBEKVAM_TID, TIDSSPILLAN, TIDSSPILLAN_OVRIG_TID; saknad nyckel
-- = ärvs). Formen ägs av zod-schemat `hourlyRatesSchema`.
--
-- Flytt:
--   organizations.default_hourly_rate     → hourly_rates.ARBETE
--   organizations.tidsspillan_hourly_rate → hourly_rates.TIDSSPILLAN
--   users.hourly_rate                     → hourly_rates.ARBETE
--   matters.hourly_rate                   → hourly_rates.ARBETE
-- Negativa priser (users.hourly_rate saknade kontroll) är meningslösa och följer
-- inte med — schemat kräver ≥ 0.
--
-- Flyttade rader får ny version + en change_log-rad: klienternas cache hämtar
-- raderna igen vid nästa pull (annars låg de kvar med de gamla fälten).

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hourly_rates jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rates jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS hourly_rates jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE organizations
SET hourly_rates = jsonb_strip_nulls(jsonb_build_object(
      'ARBETE', CASE WHEN default_hourly_rate >= 0 THEN default_hourly_rate END,
      'TIDSSPILLAN', CASE WHEN tidsspillan_hourly_rate >= 0 THEN tidsspillan_hourly_rate END)),
    version = version + 1, updated_at = now()
WHERE default_hourly_rate >= 0 OR tidsspillan_hourly_rate >= 0;

UPDATE users
SET hourly_rates = jsonb_build_object('ARBETE', hourly_rate), version = version + 1, updated_at = now()
WHERE hourly_rate >= 0;

UPDATE matters
SET hourly_rates = jsonb_build_object('ARBETE', hourly_rate), version = version + 1, updated_at = now()
WHERE hourly_rate >= 0;

INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT id, 'organization', id, version, 'update' FROM organizations
WHERE hourly_rates <> '{}'::jsonb AND deleted_at IS NULL;

INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT organization_id, 'user', id, version, 'update' FROM users
WHERE hourly_rates <> '{}'::jsonb AND deleted_at IS NULL;

INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT organization_id, 'matter', id, version, 'update' FROM matters
WHERE hourly_rates <> '{}'::jsonb AND deleted_at IS NULL;

ALTER TABLE organizations DROP COLUMN IF EXISTS default_hourly_rate;
ALTER TABLE organizations DROP COLUMN IF EXISTS tidsspillan_hourly_rate;
ALTER TABLE users DROP COLUMN IF EXISTS hourly_rate;
ALTER TABLE matters DROP COLUMN IF EXISTS hourly_rate;
