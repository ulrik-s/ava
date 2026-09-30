-- #1246: jävskontrollen per ärende.
--
-- Ett ärende som skapas offline har bara kontrollerats mot klientens lokala
-- kopia. Servern kör kontrollen mot byråns alla ärenden när anropet når den,
-- och ärendet bär resultatet: väntar, inga träffar, träffar att bedöma eller
-- bedömd. Nullable: äldre ärenden har ingen uppföljning.

ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_check_status text;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_check_hits integer;
ALTER TABLE matters ADD COLUMN IF NOT EXISTS conflict_checked_at timestamptz;
