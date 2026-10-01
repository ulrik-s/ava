-- Ny synkepok efter en återställning (#1360). Körs av restore-db.sh när
-- dumpen lästs in; samma fil används av testerna.
--
-- change_log-sekvensen har gått tillbaka till backupens läge, så klienternas
-- cursorer hör till en historik som inte finns längre. Med en ny epok synkar
-- varje klient om från 0 vid nästa pull. En dump från före migration 0041
-- har ingen epok-tabell: då gör satsen ingenting, och `db:migrate` skapar
-- tabellen med en ny epok.
DO $$
BEGIN
  IF to_regclass('sync_epoch') IS NOT NULL THEN
    INSERT INTO sync_epoch (singleton) VALUES (true)
    ON CONFLICT (singleton) DO UPDATE SET epoch = gen_random_uuid(), rotated_at = now();
  END IF;
END
$$;
