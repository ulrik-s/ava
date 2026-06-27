-- #810: rättsskyddets tidsuppdelade självrisk-split. Tvistdatum (arbete före =
-- aldrig täckt → klient 100 %) + bolagets positiva beslutsdatum (arbete före
-- beslutet är retroaktivt och täcks med högst 6 h). NULL = ej satt.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS tvist_uppkom_datum timestamptz;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rattsskydd_beslut_datum timestamptz;
