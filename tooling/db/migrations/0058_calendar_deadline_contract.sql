-- kind: contract
-- #2214 (ADR 0040 §3, contract-steget): frister är uppgifter, inte
-- kalenderhändelser. #2120 stängde vägen för nya `kind = 'deadline'`, och #2121
-- flyttade de befintliga till uppgifter vid start (uppstartsfyllningen
-- "frister"), i en tidigare release. Här raderas kalenderraderna.
--
-- Två satser, ingen CTE, så att migreringskontrollen ser raderingen:
--   1. en tombstone i change_log (`calendarEvent`, `delete`, version + 1, som
--      hardDelete) per levande rad, så att klienternas cache släpper den;
--      mjukraderade rader har redan sin tombstone;
--   2. levande och mjukraderade deadline-rader raderas. Möten står kvar.
-- Omkörning ändrar inget: det finns inga deadline-rader kvar att logga.
--
-- Ingen schemaändring: kolumnen `kind` (text, default 'appointment') står kvar
-- utan CHECK. Förra releasens kod läser bara raderna och klarar sig utan dem.

INSERT INTO change_log (organization_id, entity, row_id, version, op)
SELECT organization_id, 'calendarEvent', id, version + 1, 'delete'
FROM calendar_events
WHERE kind = 'deadline' AND deleted_at IS NULL;

DELETE FROM calendar_events WHERE kind = 'deadline';
