-- #1267: synkläget per enhet — senaste rapporten från varje webbläsare som synkar.
--
-- Server-only (ingen entitet, synkas aldrig). En rad per enhet; varje rapport
-- skriver över den förra. Admin ser listan och larmas när en enhet har en
-- osynkad ändring äldre än ett dygn eller inte synkat på en vecka.

CREATE TABLE IF NOT EXISTS "sync_devices" (
  "device_id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "label" text,
  "pending_count" integer NOT NULL,
  "oldest_pending_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "sync_devices_org_idx" ON "sync_devices" USING btree ("organization_id");
