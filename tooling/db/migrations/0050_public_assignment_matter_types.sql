-- #1638: byrån markerar vilka ärendetyper som är offentligt uppdrag.
--
-- Additivt och nullbart: NULL = aldrig satt (inga markerade), '[]' = satt
-- till tom lista. Skillnaden behövs av en senare engångsuppdatering, som bara
-- ska köras för byråer där markeringen aldrig har satts.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS public_assignment_matter_types jsonb;
