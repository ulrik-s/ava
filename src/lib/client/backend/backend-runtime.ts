/**
 * `BackendRuntime` — kloss-socketen (ADR 0001/0003).
 *
 * En backend producerar tRPC-länken som klienten pratar genom. Det är
 * den enda kopplingen mellan webapp och backend:
 *   - **Git** (local-first): in-process-länk — routrarna körs i klienten
 *     mot DemoDataStore. Offline-kapabel.
 *   - **Postgres** (server, framtida): `httpBatchLink` mot en server som
 *     kör routrarna mot en riktig databas. Online-only.
 *
 * UI:t och `appRouter` känner inte till vilken backend som är aktiv — de
 * ser bara den `trpc`-klient som byggts från `runtime.createLink()`.
 */

import type { TRPCLink } from "@trpc/client";
import type { AppRouter } from "@/lib/server/routers/_app";

export interface BackendRuntime {
  /** Bygg tRPC-länken för den aktiva backenden. */
  createLink(): TRPCLink<AppRouter>;
}
