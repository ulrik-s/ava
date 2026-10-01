-- #1345: tidsposter och utlägg måste peka på ett ärende som finns.
--
-- `time_entries.matter_id` och `expenses.matter_id` saknade främmande nyckel.
-- Tid och utlägg byråavgränsas via ärendet, så en rad vars ärende inte finns
-- tillhör ingen byrå: servern "accepterade" den, men varje läsning gav en
-- tombstone. Routrarna kontrollerar nu ärendet; nyckeln gör det omöjligt även
-- för en väg som glömmer kontrollen.
--
-- Ärenden raderas aldrig hårt (radvägens delete är mjuk, `deleted_at`), så
-- nyckeln behöver ingen ON DELETE-regel.
--
-- Befintliga föräldralösa rader får inte fälla migreringen och raderas inte
-- (de kan vara arbete som ska utredas): nyckeln läggs till NOT VALID — den
-- gäller då för alla nya och ändrade rader direkt — och valideras bara om
-- tabellen är fri från föräldralösa rader. Annars rapporteras antalet som en
-- NOTICE, och nyckeln valideras manuellt när raderna rättats:
--   ALTER TABLE time_entries VALIDATE CONSTRAINT time_entries_matter_id_fk;

DO $$
DECLARE
  spec record;
  orphans integer;
BEGIN
  FOR spec IN SELECT * FROM (VALUES ('time_entries', 'time_entries_matter_id_fk'), ('expenses', 'expenses_matter_id_fk')) AS s(tbl, con) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = spec.con AND conrelid = to_regclass(spec.tbl)) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (matter_id) REFERENCES matters (id) NOT VALID', spec.tbl, spec.con);
    END IF;
    EXECUTE format('SELECT count(*) FROM %I t WHERE NOT EXISTS (SELECT 1 FROM matters m WHERE m.id = t.matter_id)', spec.tbl) INTO orphans;
    IF orphans = 0 THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', spec.tbl, spec.con);
    ELSE
      RAISE NOTICE '%: % rader pekar på ett ärende som inte finns — % lämnas ovaliderad tills de rättats (#1345)', spec.tbl, orphans, spec.con;
    END IF;
  END LOOP;
END $$;
