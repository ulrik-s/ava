/**
 * drizzle-kit-konfiguration (ADR 0019, #408) — offline SQL-migrations ur
 * Drizzle-schemat. `drizzle-kit generate` kräver ingen live-DB. Anslutning +
 * `migrate`/`push` wires server-side i #410.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/server/db/schema.ts",
  out: "./tooling/db/migrations",
});
