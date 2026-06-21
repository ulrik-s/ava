/**
 * `systemRouter` (ADR 0027) — runtime-metadata för den kapabilitets-tierade
 * klienten. `capabilities` är klientens **probe**: den kallar denna query mot
 * den DEPLOYADE servern (HTTP) vid bootstrap för att lära sig vad servern kan
 * (server-first annonserar sina förmågor; en server utan ollama svarar
 * `llm:false`). Når probas ingen server (demon) → klienten faller tillbaka på
 * demo-baslinjen. `publicProcedure` med flit: probas före login.
 */

import { DEMO_CAPABILITIES } from "@/lib/shared/capabilities";
import { publicProcedure, router } from "../trpc-core";

export const systemRouter = router({
  capabilities: publicProcedure.query(({ ctx }) => ctx.capabilities ?? DEMO_CAPABILITIES),
});
