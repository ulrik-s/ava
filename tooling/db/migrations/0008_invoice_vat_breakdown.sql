-- #790: moms-uppdelning per sats på fakturan (driver per-sats bokföring i
-- verifikat/SIE). En rad per {kind, vatRate, netOre, vatOre}. NULL på äldre
-- fakturor → bokföring faller tillbaka på enkel-rad (oförändrat beteende).
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vat_breakdown jsonb;
