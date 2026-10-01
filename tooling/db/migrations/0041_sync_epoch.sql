-- #1360: synkens epok — byts när databasen återställs ur en backup.
--
-- Klienternas delta-cursor är ett change_log-seq från DEN HÄR databasens
-- historik. Läses en backup in går sekvensen tillbaka till backupens läge:
-- nya ändringar får nummer som klienterna redan passerat (och som tidigare
-- betydde andra ändringar), så en klient vars cursor ligger före den
-- återställda servern skulle tyst missa dem.
--
-- Epoken är ett slumpat id för databasens synkhistorik. Pullen svarar med
-- den, och klienten skickar den den har. Skiljer de sig (eller ligger
-- klientens cursor före serverns säkra gräns) börjar servern om från 0 och
-- klienten synkar om allt — köade, ej synkade ändringar ligger kvar och
-- spelas upp. `restore-db.sh` byter epok efter att dumpen lästs in.
--
-- En enda rad (singleton = true). Kolumnen heter inte `id`: tabellen är ingen
-- entitet (inga reconcile-kolumner, synkas aldrig).

CREATE TABLE IF NOT EXISTS "sync_epoch" (
  "singleton" boolean PRIMARY KEY DEFAULT true CHECK ("singleton"),
  "epoch" uuid NOT NULL DEFAULT gen_random_uuid(),
  "rotated_at" timestamp with time zone NOT NULL DEFAULT now()
);

INSERT INTO "sync_epoch" ("singleton") VALUES (true) ON CONFLICT ("singleton") DO NOTHING;
