-- #1511: försäkringsbolagets referens på ärendet.
--
-- Försäkringsbolag finns bara som kontakttyp (INSURANCE_COMPANY), så bolagets
-- referensnummer hade ingenstans att sparas. En referens per ärende, sökbar i
-- ärendelistan. Nullable: de flesta ärenden har inget försäkringsbolag.

ALTER TABLE matters ADD COLUMN IF NOT EXISTS insurance_reference text;
