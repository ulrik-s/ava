-- #901: dokumentets motpart/mottagare (DOMSTOL/MOTPART/KLIENT/FORSAKRING/MYNDIGHET/
-- OVRIGT). Med `direction` driver den filtret "dok skickade till domstol". NULL = okänt.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS recipient text;
