-- #1265 (ADR 0037): utfall av köade procedur-anrop som servern kört om.
--
-- Server-only (ingen entitet, synkas aldrig). Primärnyckeln är klientens
-- mutationId, så samma anrop körs högst en gång även om klienten skickar det
-- igen efter ett avbrott.

CREATE TABLE IF NOT EXISTS "sync_replays" (
  "mutation_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid,
  "path" text NOT NULL,
  "code_version" text NOT NULL,
  "status" text NOT NULL,
  "code" text,
  "reason" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sync_replays_org_at_idx" ON "sync_replays" USING btree ("organization_id","at");
