-- kind: expand
-- #1855: förordnandemål (DVFS 2025:5) — förhören under förundersökningen och
-- hur förundersökningen avslutades.
--
-- interrogations: ett förhör per rad (början, slut och uppehåll). Synkad,
-- org-scopad entitet (id/version/deleted_at + change_log via repot), som
-- expected_receivables. Uppehållen är en jsonb-lista med { start, end }
-- (ISO-tidpunkter). Procedurägd (ADR 0037): bara routern skriver.
--
-- matters.forundersokning_avslut: NEDLAGD, STRAFFORELAGGANDE eller INGET_ATAL.
-- Nullbar text utan standardvärde: null = inte markerat.
--
-- Additivt: äldre kod läser varken tabellen eller kolumnen.

CREATE TABLE IF NOT EXISTS interrogations (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  organization_id uuid NOT NULL,
  matter_id uuid NOT NULL REFERENCES matters(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  pauses jsonb NOT NULL DEFAULT '[]',
  CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS interrogations_matter_idx ON interrogations (matter_id);

ALTER TABLE matters ADD COLUMN IF NOT EXISTS forundersokning_avslut text;
