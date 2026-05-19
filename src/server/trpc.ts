import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { prisma } from "./db";
import type { IDataStore } from "./data-store/IDataStore";

// Server-only imports laddas lazy så modulen kan parsas i browser
// (demo-build). `createContext` är den enda export:en som faktiskt
// kör server-koden; routrarna importerar bara `router`/`procedure`
// från denna modul (TypeScript-typer + initTRPC-instans).
import { PostgresStore } from "./data-store/PostgresStore";
import { attachEventRuleExecutor } from "./rules/event-executor";
import { attachPaymentScanListener } from "./services/payment-scan-listener";

/** Bygg per-request dataStore + fäst regelmotorn som listener. */
function buildContextDataStore(organizationId: string): IDataStore {
  const ds = PostgresStore.forOrganization(prisma, organizationId);
  // Event-trigrade regler kör automatiskt när routrar emittar events.
  // Listeners är scoped till denna PostgresEventLog som garbage-collectas
  // när requesten slutar — så ingen ackumulering.
  attachEventRuleExecutor(prisma, ds, organizationId);
  // Domän-listener för payment-scan (Fas 1.5).
  attachPaymentScanListener(prisma, ds, organizationId);
  return ds;
}

export type Context = {
  prisma: typeof prisma;
  /**
   * `dataStore` är den nya abstraktionen (se `docs/architecture-future.md` §6).
   * Initialt exponerar den bara `events` — domän-repos läggs till i Fas 2.
   * Existing routrar fortsätter använda `ctx.prisma` tills de migreras.
   */
  dataStore: IDataStore;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organizationId: string;
  } | null;
};

export async function createContext(opts?: { req?: Request; resHeaders?: Headers }): Promise<Context> {
  // Lazy server-only imports — NextAuth-providers + bcryptjs får inte
  // hamna i client-bundle:n.
  const { getServerSession } = await import("next-auth/next");
  const { authOptions } = await import("@/lib/auth");

  // Try real NextAuth session first
  const session = await getServerSession(authOptions);
  if (session?.user) {
    return {
      prisma,
      dataStore: buildContextDataStore(session.user.organizationId),
      user: {
        id: session.user.id,
        email: session.user.email!,
        name: session.user.name!,
        role: session.user.role,
        organizationId: session.user.organizationId,
      },
    };
  }

  // Dev fallback
  if (process.env.NODE_ENV === "development" || process.env.DEV_USER === "true") {
    // Try to get or create a dev user
    let org = await prisma.organization.findFirst();
    if (!org) {
      org = await prisma.organization.create({
        data: { name: "Dev Advokatbyrå" },
      });
    }

    let user = await prisma.user.findFirst({
      where: { email: "dev@example.com" },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "dev@example.com",
          name: "Dev Advokat",
          role: "ADMIN",
          hourlyRate: 2500,
          passwordHash: "$2b$12$1RRBOoane3DtOO76JSe0zOekR63zYvr2TL/GWx6gnpLJI/CvBwktC", // admin123
          organizationId: org.id,
        },
      });
    }

    return {
      prisma,
      dataStore: buildContextDataStore(user.organizationId),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  // För oinloggade requests har vi ingen byrå-kontext, så vi ger en
  // "tom" store som kastar vid varje anrop. Ingen public-procedure ska
  // anropa dataStore innan auth-middleware körts.
  return {
    prisma,
    dataStore: PostgresStore.forOrganization(prisma, "__unauthenticated__"),
    user: null,
  };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);

/**
 * orgProcedure — kortare form av `protectedProcedure` som exponerar
 * `ctx.orgId`. Bruk: om din procedure behöver organizationId, använd den
 * här istället för att skriva `ctx.user.organizationId` överallt.
 *
 *   orgProcedure.input(...).query(({ ctx, input }) =>
 *     ctx.prisma.foo.findMany({ where: { organizationId: ctx.orgId } })
 *   )
 */
export const orgProcedure = protectedProcedure.use(({ ctx, next }) =>
  next({ ctx: { ...ctx, orgId: ctx.user.organizationId } }),
);

/**
 * requireOrgOwned — generisk helper som validerar att en resurs både
 * existerar OCH tillhör anropande organisation.
 *
 * Kastar NOT_FOUND om `finder()` returnerar null eller om resursens
 * `organizationId` inte matchar. Designvalet att använda NOT_FOUND (och
 * inte FORBIDDEN) är medvetet — vi vill inte läcka existens över org-gränser.
 *
 * Användning:
 *   const doc = await requireOrgOwned(
 *     () => ctx.prisma.document.findUnique({ where: { id }, include: { matter: true } }),
 *     ctx.orgId,
 *     (d) => d.matter.organizationId,
 *   );
 *
 * Gör `T extends object` för att blockera primitives; `ownerOf` är en
 * typad extractor eftersom resursens orgId kan ligga olika djupt.
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
