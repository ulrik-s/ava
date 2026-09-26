-- #1215: serverns fulltextindex — text per sida i varje dokument.
--
-- Server-only: ingen entitet (inget id/version/deleted_at), inget change_log,
-- synkas aldrig till klienter. Org-scopas via documents → matters.
-- `tsv` genereras med 'swedish'-stemming ("stämningar" hittar "stämning");
-- GIN-indexet gör `tsv @@ websearch_to_tsquery('swedish', …)` snabb.
-- Hård delete av dokumentet kaskaderar; mjuk delete rensar i dokument-repot.
-- Befintliga dokument fylls på av tooling/scripts/backfill-search-index.ts.

CREATE TABLE IF NOT EXISTS document_pages (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_no integer NOT NULL CHECK (page_no >= 1),
  text text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('swedish'::regconfig, text)) STORED,
  PRIMARY KEY (document_id, page_no)
);

CREATE INDEX IF NOT EXISTS document_pages_tsv_idx ON document_pages USING gin (tsv);
