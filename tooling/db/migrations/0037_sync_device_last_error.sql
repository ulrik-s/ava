-- #1353: enheten rapporterar också efter en misslyckad synk — och varför den
-- misslyckades. Nullbar: null betyder att den senaste synken lyckades, och
-- befintliga rader (rapporterade efter lyckade synkar) får null.

ALTER TABLE "sync_devices" ADD COLUMN IF NOT EXISTS "last_error" text;
