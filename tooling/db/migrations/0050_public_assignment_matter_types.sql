-- #1638: byråns markering av vilka ärendetyper som är offentligt uppdrag.
--
-- Additivt och nullable: NULL = aldrig satt (inga typer markerade), skilt från
-- en tom lista. En senare engångsuppdatering körs bara för byråer med NULL.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_assignment_matter_types jsonb;
