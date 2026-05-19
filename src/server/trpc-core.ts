/**
 * `trpc-core.ts` — browser-safe tRPC-byggblock.
 *
 * Innehåller:
 *   - `Context`-type med ports + dataStore
 *   - `initTRPC`-instans + `router`/`procedure`-shortcuts
 *   - middleware (`isAuthed`, `orgProcedure`)
 *   - `requireOrgOwned`-helper
 *
 * Importerar INGA konkreta server-deps (prisma, next-auth, services).
 * Det är medvetet — routrar kan importera trpc-core säkert i
 * browser-bundle:n via `appRouter.createCaller`.
 *
 * Server-side `createContext` lever i `trpc-server.ts` (separat fil
 * så den polluterade import-koden inte hamnar i client-bundle:n).
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { IDataStore } from "./data-store/IDataStore";
import type { IPorts } from "./ports";

export type Context = {
  /** Read/write-data via abstraktion. Demo-läget wirar DemoDataStore. */
  dataStore: IDataStore;
  /** Server-side ports (email, search, etc). Demo wirar no-ops. */
  ports: IPorts;
  /** Inloggad användare. `null` för publika rutter eller demo. */
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string;
  } | null;
};

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * orgProcedure — kortare form av `protectedProcedure` som exponerar
 * `ctx.orgId`.
 */
export const orgProcedure = protectedProcedure.use(({ ctx, next }) =>
  next({ ctx: { ...ctx, orgId: ctx.user.organizationId } }),
);

/**
 * requireOrgOwned — validerar att en resurs både existerar OCH
 * tillhör anropande organisation. NOT_FOUND vid mismatch (läcker
 * inte existens över org-gränser).
 */
export async function requireOrgOwned<T extends object>(
  finder: () => Promise<T | null>,
  orgId: string,
  ownerOf: (row: T) => string,
): Promise<T> {
  const row = await finder();
  if (!row || ownerOf(row) !== orgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return row;
}

export { TRPCError };
