/**
 * Prisma-client som "lazy" singleton.
 *
 * Designval (lazy init): `createPrismaClient()` anropas inte vid
 * modul-laddning utan vid första prop-access. Detta gör att modulen
 * kan importeras säkert i browser-kontext (statisk export, demo-läge)
 * utan att försöka instansiera PrismaPg som kräver Node-only beroenden.
 *
 * I server-runtime triggas init vid första `prisma.matter.findMany()`
 * etc. och cachas på `globalForPrisma` så hot-reload inte spawnar
 * nya connection pools.
 */

import type { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Dynamiska imports gör att browser-bundlern kan tree-shaka ut
  // adaptern när modulen aldrig faktiskt accessas i client-koden.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: PC } = require("@prisma/client") as { PrismaClient: new (opts: unknown) => PrismaClient };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg") as { PrismaPg: new (url: string) => unknown };
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const client = new PC({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}

function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Proxy-baserad lazy prisma. Egenskaper resolvas vid första access,
 * vilket gör modulen säker att importera i client-bundlar.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    return (getPrisma() as unknown as Record<string | symbol, unknown>)[prop];
  },
}) as PrismaClient;
