-- #1510: tidigare målnummer på ärendet.
--
-- Domstolar byter ibland målnummer. När ärendets målnummer byts från ett
-- ifyllt värde till ett annat sparas det gamla här, så att det fortfarande
-- går att söka på. Bara ett tidigare nummer sparas. Nullable: de flesta
-- ärenden har aldrig bytt målnummer.

ALTER TABLE matters ADD COLUMN IF NOT EXISTS previous_court_case_number text;
