-- #1632 / ADR 0038: en mekanism för dokumenttyp.
--
-- Dokumentets typer blir EN lista (`kinds`, primär först) med inbyggda koder
-- eller byråns egna typer, och `kinds_manual` säger att en person (eller
-- systemet som skapade dokumentet) har satt dem. Byråns egna typer ersätter
-- taggvokabulären.
--
-- Bara schema här, additivt. Data flyttas av serverns backfill efter omstarten
-- (src/lib/server/jobs/document-kinds-backfill.ts) — då är den gamla servern
-- stoppad, så även rader den hann skriva efter migrationen kommer med, och
-- normaliseringen finns på ETT ställe (src/lib/shared/document-kinds.ts).
--
-- `document_type`, `tags` och `document_tags` finns kvar under övergången
-- (äldre klienter läser och skriver dem) och tas bort i en egen PR.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS kinds jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS kinds_manual boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS document_kinds jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Typfiltret och fritextsökningen matchar mot `kinds` (`?|`).
CREATE INDEX IF NOT EXISTS documents_kinds_idx ON documents USING gin (kinds);
