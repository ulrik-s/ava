-- #778: klientens andel (självrisk/avgift) i basis points på ärendet.
-- Relevant för rättsskydd/rättshjälp där klienten betalar en %-sats av
-- upparbetat värde. Nullable — bara satt när paymentMethod kräver det. Kan
-- ändras under ärendets gång (klientens inkomst kan ändras → ändrad andel).
ALTER TABLE matters ADD COLUMN IF NOT EXISTS client_share_bips integer;
