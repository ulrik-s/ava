-- kind: expand
-- #1901: logg över skickade mejl per byrå. E-posthandlern skriver byrån och
-- mejlets idempotensnyckel efter ett lyckat utskick, och skickar aldrig samma
-- nyckel två gånger, inte heller långt senare (ADR 0024 lager 2).
--
-- Serverintern som sync_replays: ingen entitet, synkas aldrig. Nyckeln är
-- byrån + idempotensnyckeln (som sync_replays_pk). Mottagare, ämnesrad och
-- text sparas inte.
--
-- Additivt: äldre kod läser och skriver inte tabellen.

CREATE TABLE IF NOT EXISTS email_dispatch_log (
  organization_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_dispatch_log_pk PRIMARY KEY (organization_id, idempotency_key)
);
