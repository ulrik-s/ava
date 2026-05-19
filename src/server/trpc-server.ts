/**
 * `trpc-server.ts` — server-only `createContext`.
 *
 * Innehåller all polluterad server-kod (prisma, next-auth-providers,
 * payment-scan, etc.) som INTE får hamna i client-bundle:n.
 *
 * Importeras endast från `app/api/trpc/[trpc]/route.ts` (server-route).
 * Routrarna importerar `trpc-core` istället.
 */

import { prisma } from "./db";
import type { Context } from "./trpc-core";
import { PostgresStore } from "./data-store/PostgresStore";
import { attachEventRuleExecutor } from "./rules/event-executor";
import { attachPaymentScanListener } from "./services/payment-scan-listener";
import type { IDataStore } from "./data-store/IDataStore";
import type { IPorts } from "./ports";

function buildContextDataStore(organizationId: string): IDataStore {
  const ds = PostgresStore.forOrganization(prisma, organizationId);
  attachEventRuleExecutor(prisma, ds, organizationId);
  attachPaymentScanListener(prisma, ds, organizationId);
  return ds;
}

/** Server-side ports — dynamic imports så client-bundlern inte drar in. */
async function buildServerPorts(dataStore: IDataStore): Promise<IPorts> {
  const [{ sendEmail }, { runPaymentScan }, { analyzeDocument }, mei] = await Promise.all([
    import("./services/email"),
    import("./services/payment-scan"),
    import("./services/document-analysis"),
    import("./services/meilisearch"),
  ]);
  return {
    email: { send: (i) => sendEmail(i) },
    paymentScanner: {
      scan: async (org) => { await runPaymentScan(prisma, dataStore, org); },
    },
    documentAnalyzer: { analyze: (id) => analyzeDocument(id) },
    searchIndex: {
      search: (q, org, limit) => mei.searchDocuments(q, org, limit),
      upsert: async (d) => { await mei.indexDocument(d); },
      remove: async (id) => { await mei.removeDocument(id); },
    },
  };
}

export async function createContext(_opts?: { req?: Request; resHeaders?: Headers }): Promise<Context> {
  const { getServerSession } = await import("next-auth/next");
  const { authOptions } = await import("@/lib/auth");

  const session = await getServerSession(authOptions);
  if (session?.user) {
    const ds = buildContextDataStore(session.user.organizationId);
    return {
      dataStore: ds,
      ports: await buildServerPorts(ds),
      user: {
        id: session.user.id,
        email: session.user.email!,
        name: session.user.name!,
        role: session.user.role,
        organizationId: session.user.organizationId,
      },
    };
  }

  if (process.env.NODE_ENV === "development" || process.env.DEV_USER === "true") {
    let org = await prisma.organization.findFirst();
    if (!org) org = await prisma.organization.create({ data: { name: "Dev Advokatbyrå" } });

    let user = await prisma.user.findFirst({ where: { email: "dev@example.com" } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: "dev@example.com",
          name: "Dev Advokat",
          role: "ADMIN",
          hourlyRate: 2500,
          passwordHash: "$2b$12$1RRBOoane3DtOO76JSe0zOekR63zYvr2TL/GWx6gnpLJI/CvBwktC",
          organizationId: org.id,
        },
      });
    }

    const ds = buildContextDataStore(user.organizationId);
    return {
      dataStore: ds,
      ports: await buildServerPorts(ds),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
    };
  }

  const ds = PostgresStore.forOrganization(prisma, "__unauthenticated__");
  return {
    dataStore: ds,
    ports: await buildServerPorts(ds),
    user: null,
  };
}
