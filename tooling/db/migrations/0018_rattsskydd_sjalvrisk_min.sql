-- #899: rättsskyddets lägsta självrisk (öre) — försäkringsbeslut anger ofta
-- "självrisk 20 %, dock lägst 1 800 kr". NULL = ingen golv-självrisk.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rattsskydd_sjalvrisk_min_ore integer;
