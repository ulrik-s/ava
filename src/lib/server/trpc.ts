/**
 * `trpc.ts` — back-compat re-export.
 *
 * Routrar importerar fortfarande `from "../trpc"` av historiska skäl;
 * vi re-exporterar trpc-core (browser-safe) härifrån.
 *
 * `createContext` lever i `trpc-server.ts` (server-only). Det enda
 * stället som importerar det är `app/api/trpc/[trpc]/route.ts`.
 */

export {
  router,
  publicProcedure,
  protectedProcedure,
  orgProcedure,
  requireOrgOwned,
  TRPCError,
  type Context,
} from "./trpc-core";
