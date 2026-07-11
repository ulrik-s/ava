-- #876: persisterad slutregleringsvy på fakturan — EN källa för både faktura-
-- dokumentet och Slutfaktura-sidan (/invoices/[id]), så de aldrig glider isär.
-- Sätts vid settleCoverage på klient-/betalar-fakturan; NULL på övriga fakturor.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS settlement_breakdown jsonb;
