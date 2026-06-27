-- #811: datum då rättsskydd NEKADES. Satt → nästa steg är att ansöka om
-- rättshjälp (om klientens ekonomiska underlag ≤ 6 § rättshjälpslagen). NULL = ej nekat.
ALTER TABLE matters ADD COLUMN IF NOT EXISTS rattsskydd_nekad_at timestamptz;
