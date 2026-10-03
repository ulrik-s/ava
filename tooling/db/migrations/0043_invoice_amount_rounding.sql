-- #1438: fakturans radavrundning.
--
-- Nya fakturor avrundar varje rad till hela kronor och bär 'KRONOR'. Äldre
-- fakturor (null) är avrundade på öret — deras specifikation räknas med
-- öresavrundning när dokumentet renderas om, så det visar samma rader som det
-- som skickades. Inga befintliga belopp ändras.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_rounding text;
