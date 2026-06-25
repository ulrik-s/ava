-- #782: exakt momsbelopp per faktura (öre), beräknat per momssats vid skapande.
-- netto = amount − vat_ore. NULL på äldre fakturor → bokföring/PDF faller tillbaka
-- på 25 %-split (oförändrat beteende).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_ore integer;
