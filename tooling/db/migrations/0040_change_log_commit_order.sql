-- #1381: delta-pullen går aldrig förbi en change_log-rad som committas senare.
--
-- Pullen läser `seq > cursor` och klienten flyttar cursorn till högsta seq den
-- sett. Med en vanlig bigserial tilldelas seq när raden SKRIVS men blir synlig
-- först när transaktionen COMMITTAR: T1 får seq 100 och är inte klar, T2 får
-- 101 och committar, en klient pullar (cursor = 101), T1 committar — raden med
-- seq 100 ligger nu under cursorn och hämtas aldrig.
--
-- Två delar:
--
-- 1. Slutligt seq delas ut vid commit. Raden skrivs med ett preliminärt
--    nummer (som förut); en uppskjuten trigger ger den ett nytt nummer när
--    transaktionen committar, medan transaktionen håller publiceringslåset
--    DELAT. Låset släpps först när commiten är synlig (eller transaktionen
--    rullats tillbaka). Committande transaktioner väntar inte på varandra,
--    och en lång transaktion håller inget förrän den committar. Ordningen
--    inom en transaktion behålls (triggerhändelserna körs i skrivordning).
--
-- 2. Pullen läser bara upp till en säker gräns: `change_log_safe_seq()` tar
--    låset EXKLUSIVT en kort stund och läser sekvensens senaste värde H. När
--    det exklusiva låset beviljas står ingen transaktion mellan "fick sitt
--    slutliga seq" och "commiten syns", och ingen kan dela ut ett nytt
--    slutligt seq förrän låset släpps. Alltså är varje rad med slutligt seq
--    ≤ H redan committad och synlig (eller borta), och varje rad som committar
--    senare får ett seq > H (nextval är monoton; sekvensen har CACHE 1).
--    Preliminära nummer syns aldrig — de byts alltid ut före commit.
--    Pullen läser `cursor < seq ≤ H` i en SENARE sats och sätter cursorn till H.
--
-- Den som håller låset väntar inte på något annat lås: skrivaren numrerar bara
-- om sina egna rader (det finns inga andra uppskjutna villkor), läsaren läser
-- bara sekvensen. Alla som skriver change_log (repona, köade procedurer,
-- pg-boss-jobb, migrationer med rå SQL) går genom triggern — den sitter i
-- databasen. Ett xid-vattenmärke (`xid < pg_snapshot_xmin`) räcker inte:
-- transaktions-id och seq kan gå åt olika håll, och varje lång transaktion i
-- klustret skulle hålla tillbaka alla klienters pull.
--
-- Befintliga rader berörs inte. Transaktioner som skrev change_log innan
-- triggern fanns har committat när den skapas (CREATE TRIGGER väntar ut dem).

CREATE OR REPLACE FUNCTION change_log_publish() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('ava.change_log.publish', 0));
  UPDATE change_log SET seq = nextval(pg_get_serial_sequence('change_log', 'seq')) WHERE seq = NEW.seq;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION change_log_safe_seq() RETURNS bigint
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ava.change_log.publish', 0));
  RETURN COALESCE(pg_sequence_last_value(pg_get_serial_sequence('change_log', 'seq')::regclass), 0);
END
$$;

DROP TRIGGER IF EXISTS change_log_publish ON change_log;
CREATE CONSTRAINT TRIGGER change_log_publish
  AFTER INSERT ON change_log
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION change_log_publish();
