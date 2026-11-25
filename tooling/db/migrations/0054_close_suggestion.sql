-- kind: expand
-- #2098: grunden för att Att åtgärda ska kunna föreslå att ett ärende avslutas.
--
-- matters.kept_active_at: när någon senast valde Behåll som aktivt för ärendet.
-- Null = ingen har valt det.
--
-- documents.final_ruling: dokumentet har känts igen som ett slutligt avgörande
-- (AVSKRIVNING, DOM_HD, DOM_HFD, PT_HD, PT_HFD). Null = inget igenkänt.
--
-- Båda är nullbara, utan standardvärde och utan backfill, så förra versionens
-- kod klarar schemat.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS kept_active_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS final_ruling text;
