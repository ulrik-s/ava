-- #1220: delar av sammansatta dokument — "kallelse + stämning + FUP" i EN PDF.
--
-- Filen delas aldrig fysiskt; en del är metadata: kategori (`kind`, samma koder
-- som documents.document_type) + sidintervall (1-baserat, inklusive).
-- Synkad entitet (id/version/deleted_at + change_log via repot). Tabellen saknar
-- organization_id — org härleds via `matter_id` (speglar dokumentets ärende),
-- samma mönster som document_folders (#528).
--
-- `source`: AUTO = klassificeringsjobbets segmentering (ersätts vid omklassning),
-- MANUAL = användaren rättade delens typ (bevaras så länge sidantalet är samma).
-- Befintliga dokument får delar vid nästa klassificering, eller via
-- `bun tooling/scripts/backfill-search-index.ts --reclassify`.

CREATE TABLE IF NOT EXISTS document_parts (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  matter_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  kind text NOT NULL,
  from_page integer NOT NULL CHECK (from_page >= 1),
  to_page integer NOT NULL,
  source text NOT NULL CHECK (source IN ('AUTO', 'MANUAL')),
  CHECK (to_page >= from_page)
);

CREATE INDEX IF NOT EXISTS document_parts_document_idx ON document_parts (document_id);
CREATE INDEX IF NOT EXISTS document_parts_matter_idx ON document_parts (matter_id);
