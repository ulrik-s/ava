-- #1251: domstolens beviljade belopp som bigint, som i Drizzle-schemat.
--
-- 0012 skapade `awarded_ore` som integer medan schemat (och alla andra
-- öre-kolumner) är bigint. Migrationskontrollen hittade avvikelsen. En
-- integer räcker till 21 miljoner kronor, men typen ska vara densamma som
-- routrarna räknar med, och bytet är förlustfritt.

ALTER TABLE billing_runs ALTER COLUMN awarded_ore TYPE bigint;
