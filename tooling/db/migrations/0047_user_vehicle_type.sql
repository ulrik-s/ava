-- #1528: juristens biltyp för milersättningen.
--
-- Juristen väljer biltyp under Min profil, och milersättningen (mileage_rate,
-- öre/km) fylls i enligt Skatteverkets schablon för den biltypen. Nullable:
-- befintliga användare har ingen biltyp vald.

ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_type text;
