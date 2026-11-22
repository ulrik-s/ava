-- kind: expand
-- #1818: jävskontrollens logg kopplas till ärendet, och ärendet får plats för
-- träffarna.
--
-- conflict_checks.matter_id: ärendet kontrollen gällde. Ingen främmande nyckel
-- (som document_parts.matter_id); radkön prövar att ärendet är byråns eget.
-- Null = en fristående kontroll eller en rad från före den här migrationen.
--
-- matters.conflict_check_results: senaste kontrollens träffar.
-- matters.conflict_reviewed_hits: de träffar som senast bedömdes.
-- Nullbara jsonb utan standardvärde (som 0050): null = aldrig sparade.
--
-- Additivt: äldre kod läser och skriver tabellerna som förut.

ALTER TABLE conflict_checks ADD COLUMN IF NOT EXISTS matter_id uuid;
CREATE INDEX IF NOT EXISTS conflict_checks_matter_idx ON conflict_checks (matter_id);
ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_check_results jsonb;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_reviewed_hits jsonb;
