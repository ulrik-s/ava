-- #793: täcknings-tak för rättsskydd (maxbelopp i öre) resp. rättshjälp (timtak,
-- default 100 i UI). Driver 90 %-varningsbadgen. NULL = ej satt.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rattsskydd_max_ore integer;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rattshjalp_max_timmar integer;
