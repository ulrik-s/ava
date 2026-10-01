-- #1353: sync_replays nycklas på (organization_id, mutation_id), inte bara mutation_id.
--
-- Omkörningens uppslag är byråavgränsade (`WHERE mutation_id = … AND
-- organization_id = …`), men primärnyckeln var bara mutation_id (0030). En rad
-- från en annan byrå med samma mutationId fick då byråns INSERT … ON CONFLICT
-- DO NOTHING att tyst göra ingenting — utfallet sparades aldrig, och nästa
-- omkörning körde anropet igen.
--
-- Säkert mot befintlig data: raderna är redan unika på mutation_id, så de är
-- trivialt unika på (organization_id, mutation_id), och båda kolumnerna är NOT
-- NULL. Den gamla nyckeln (`sync_replays_pkey`, Postgres namn för 0030:s
-- inline-PRIMARY KEY) tas bort och den nya läggs till i samma transaktion
-- (db:migrate kör varje fil i en egen transaktion) — tabellen är aldrig utan
-- nyckel för någon annan. Idempotent: körs inget om den nya nyckeln redan finns.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sync_replays_pk' AND conrelid = 'sync_replays'::regclass
  ) THEN
    ALTER TABLE "sync_replays" DROP CONSTRAINT IF EXISTS "sync_replays_pkey";
    ALTER TABLE "sync_replays" ADD CONSTRAINT "sync_replays_pk" PRIMARY KEY ("organization_id", "mutation_id");
  END IF;
END $$;
