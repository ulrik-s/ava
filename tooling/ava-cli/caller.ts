/**
 * `caller` — transport-agnostisk åtkomst till hela `appRouter`-ytan.
 *
 * Två impl:er bakom EN `invoke(path, input)`, precis de två bevisade sömmarna
 * i kodbasen:
 *   - LOCAL  — `appRouter.createCaller(ctx)` mot en seedad in-memory-store
 *     (samma mönster som integrationstesterna, `seed-smoke.test.ts`). Ingen
 *     server, ingen auth → offline-sandlåda för en AI + CI.
 *   - REMOTE — `createTRPCClient<AppRouter>()` över HTTP med Bearer-token
 *     (samma mönster som helper-ui/Office-add-ins, ADR 0031/0013) → mot en
 *     körande server-first (Postgres), auktoritativt.
 *
 * All affärslogik bor i `appRouter`; det här är bara transport. Noll duplicering.
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import { appRouter, type AppRouter } from "@/lib/server/routers/_app";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { asId } from "@/lib/shared/schemas/ids";
import { buildSeed } from "../scripts/seed-data";
import type { ProcedureType } from "./introspect";

/** En anropbar vy av AVA-API:t. `invoke` tar dotted path + JSON-input. */
export interface AvaCaller {
  invoke(path: string, input: unknown): Promise<unknown>;
  close(): Promise<void>;
}

/** Local-mode-principal (default = seed:ens admin, som i integrationstesterna). */
export interface LocalPrincipal {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "LAWYER";
  organizationId: string;
}

const DEFAULT_PRINCIPAL: LocalPrincipal = {
  id: "current-user",
  email: "user@firma.local",
  name: "Anna Advokat",
  role: "ADMIN",
  organizationId: "firma-ab",
};

/** Bygg en seedad `DemoSource` ur den delade seed-fabriken (`buildSeed`). */
function seededSource(): DemoSource {
  const seed = buildSeed();
  return prebakeJoins({
    organizations: seed.organizations,
    offices: seed.offices,
    users: seed.users,
    contacts: seed.contacts,
    matters: seed.matters,
    matterContacts: seed.matterContacts,
    documents: seed.documents,
    timeEntries: seed.timeEntries,
    expenses: seed.expenses,
    invoices: seed.invoices,
    calendarEvents: seed.calendarEvents,
    tasks: seed.tasks,
    documentTemplates: seed.documentTemplates,
    conflictChecks: seed.conflictChecks,
    paymentPlans: seed.paymentPlans,
    paymentPlanReminders: seed.paymentPlanReminders,
    payments: seed.payments,
  } as DemoSource);
}

/** Procedurer/callers är callable-objekt → `object`-test räcker inte. */
function isObjectLike(v: unknown): v is Record<string, unknown> {
  return v !== null && (typeof v === "object" || typeof v === "function");
}

/**
 * Gå ned i ett objekt via dotted path; kastar på okänd path. Direkt
 * property-access (inte `in`) eftersom tRPC:s caller/klient är en Proxy utan
 * `has`-trap → `"x" in proxy` ljuger.
 */
function resolveNode(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (!isObjectLike(cur)) throw new Error(`Okänd procedur: ${path}`);
    cur = cur[seg];
    if (cur === undefined) throw new Error(`Okänd procedur: ${path}`);
  }
  return cur;
}

type ProcFn = (input: unknown) => Promise<unknown>;

function asProcFn(node: unknown, path: string): ProcFn {
  if (typeof node !== "function") throw new Error(`Okänd procedur: ${path}`);
  return node as ProcFn;
}

/** Branda de plana id-strängarna till principal-formen routrarna kräver. */
function toPrincipal(p: LocalPrincipal): Principal {
  return {
    id: asId<"UserId">(p.id),
    email: p.email,
    name: p.name,
    role: p.role,
    organizationId: asId<"OrganizationId">(p.organizationId),
  };
}

/** LOCAL: in-process caller mot seedad store (ingen server/auth). */
export function createLocalCaller(principal: LocalPrincipal = DEFAULT_PRINCIPAL): AvaCaller {
  const dataStore = new DemoDataStore(seededSource(), async () => {
    /* no-op write-back (mimikar prod:s FSA/OPFS så delegates är skrivbara) */
  });
  const caller = appRouter.createCaller({
    user: toPrincipal(principal),
    dataStore,
    ports: buildGitPorts(dataStore),
    repos: buildInMemoryRepositories(dataStore),
  });
  return {
    invoke: (path, input) => asProcFn(resolveNode(caller, path), path)(input),
    close: () => Promise.resolve(),
  };
}

/** tRPC-endpointens suffix (matchar helper-ui/server-first `/api/trpc`). */
export function trpcEndpoint(serverUrl: string): string {
  return `${serverUrl.replace(/\/+$/, "")}/api/trpc`;
}

export interface RemoteOpts {
  serverUrl: string;
  token: string;
}

/** REMOTE: tunn tRPC-over-HTTP-klient mot server-first, Bearer-auth. */
export function createRemoteCaller(opts: RemoteOpts, types: Map<string, ProcedureType>): AvaCaller {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: trpcEndpoint(opts.serverUrl),
        transformer: superjson,
        headers: () => ({ authorization: `Bearer ${opts.token}` }),
      }),
    ],
  });
  return {
    invoke: (path, input) => {
      const node = resolveNode(client, path);
      const method = types.get(path) === "mutation" ? "mutate" : "query";
      if (node === null || typeof node !== "object") throw new Error(`Okänd procedur: ${path}`);
      return asProcFn((node as Record<string, unknown>)[method], path)(input);
    },
    close: () => Promise.resolve(),
  };
}
