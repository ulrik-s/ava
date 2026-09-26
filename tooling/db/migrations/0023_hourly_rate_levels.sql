-- Timpris på tre nivåer: byråns standard → juristens → ärendets (ovanligt) avvikande.
-- En ny tidspost får det mest specifika som finns; priset sparas på posten.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_hourly_rate integer;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS hourly_rate integer;
