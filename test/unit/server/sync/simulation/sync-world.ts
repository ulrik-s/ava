/**
 * Simuleringsvärlden för synken (#1268, #1358, ADR 0037).
 *
 * En server: pglite bakom den riktiga tRPC-handlern, med synkstore och
 * omkörning — en handler per byrå mot SAMMA databas (byråerna delar tabeller,
 * change_log och sync_replays, precis som i en databas med flera byråer).
 *
 * Två byråer med var sin uppsättning användare och roller:
 *   - Byrå A: administratör (prefix S), jurist (prefix AL) och assistent.
 *   - Byrå B: en jurist som servern har som LAWYER men vars webbläsare har
 *     ADMIN cachat (degraderad medan den var offline), och en assistent.
 *
 * Servern loggar varje utfall den ger (accepterad, avvisad, konflikt, med
 * kod) och i vilken ordning den accepterade dem. Det är vad invarianterna
 * prövas mot.
 */
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { QueuedMutation, QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DrizzleProcedureReplayer, type ProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { RowPusher } from "@/lib/server/sync/row-push-policy";
import type { SyncStore } from "@/lib/server/sync/sync-store";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { createTestDb, type TestDbHandle } from "../../db/pg-test-db";

/** Ett fast, giltigt UUIDv7-format — samma id:n i varje värld (seriell omkörning). */
export function fixedId(n: number): string {
  return `00000000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

/** En användare: samma id på servern och i webbläsarens principal. */
export interface SimUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  /** Rollen servern har för användaren. */
  readonly role: UserRole;
  readonly prefix?: string;
}

export interface SimMatter {
  readonly id: string;
  readonly number: string;
  readonly paymentMethod: "PRIVAT" | "OFFENTLIGT_UPPDRAG";
  readonly responsible: string;
}

/** En byrå och det som finns i den från början. */
export interface Firm {
  readonly key: "A" | "B";
  readonly org: string;
  readonly users: readonly SimUser[];
  readonly matters: readonly SimMatter[];
  readonly contact: string;
  readonly timeEntry: string;
  readonly document: string;
  /** Händelseförslag ur dokumentet (en surface-entitet i radkön: radkonflikter). */
  readonly suggestions: readonly string[];
}

const YEAR = new Date().getFullYear();

function user(n: number, firm: string, name: string, role: UserRole, prefix?: string): SimUser {
  return { id: fixedId(n), email: `${name.toLowerCase()}@${firm}.se`, name, role, ...(prefix ? { prefix } : {}) };
}

export const FIRM_A: Firm = {
  key: "A",
  org: fixedId(0x1358a),
  users: [user(0xa1, "a", "Admin", "ADMIN", "S"), user(0xa2, "a", "Jurist", "LAWYER", "AL"), user(0xa3, "a", "Assistent", "ASSISTANT")],
  matters: [
    { id: fixedId(0xa101), number: `S${YEAR}-0001`, paymentMethod: "PRIVAT", responsible: fixedId(0xa1) },
    { id: fixedId(0xa102), number: `S${YEAR}-0002`, paymentMethod: "OFFENTLIGT_UPPDRAG", responsible: fixedId(0xa1) },
  ],
  contact: fixedId(0xa201),
  timeEntry: fixedId(0xa501),
  document: fixedId(0xa301),
  suggestions: [fixedId(0xa401), fixedId(0xa402)],
};

export const FIRM_B: Firm = {
  key: "B",
  org: fixedId(0x1358b),
  users: [user(0xb1, "b", "Lena", "LAWYER"), user(0xb2, "b", "Bo", "ASSISTANT")],
  matters: [{ id: fixedId(0xb101), number: `${YEAR}-0001`, paymentMethod: "PRIVAT", responsible: fixedId(0xb1) }],
  contact: fixedId(0xb201),
  timeEntry: fixedId(0xb501),
  document: fixedId(0xb301),
  suggestions: [fixedId(0xb401)],
};

export const FIRMS: readonly Firm[] = [FIRM_A, FIRM_B];

/** Byrån en användare hör till. */
export function firmOf(userId: string): Firm {
  const firm = FIRMS.find((f) => f.users.some((u) => u.id === userId));
  if (!firm) throw new Error(`okänd användare ${userId}`);
  return firm;
}

/** Den andra byrån (målet för manipulerade köposter). */
export function otherFirm(firm: Firm): Firm {
  return firm.key === "A" ? FIRM_B : FIRM_A;
}

/** Ett utfall servern gav, i den ordning det kom. */
export type ServerOutcome =
  | { kind: "procedure"; call: QueuedProcedureCall; userId: string; org: string; status: "accepted" | "rejected"; code?: string }
  | { kind: "row"; mutation: QueuedMutation; pusher: RowPusher; status: "accepted" | "rebased" | "conflict"; reason?: string };

function idOf(o: ServerOutcome): string {
  return o.kind === "procedure" ? o.call.mutationId : o.mutation.mutationId;
}

/** Serverns sida: databasen, en handler per byrå och loggen över utfall. */
export class SimServer {
  readonly outcomes = new Map<string, ServerOutcome>();
  /** Accepterade ändringar i den ordning servern tillämpade dem (en gång per mutationId). */
  readonly applied: ServerOutcome[] = [];
  /** Alla utfall i ordning — en omkörning av samma id syns flera gånger. */
  readonly log: ServerOutcome[] = [];
  repos!: DrizzleRepositories;
  handle!: TestDbHandle;
  sync!: DrizzleSyncStore;
  private readonly handlers = new Map<string, (req: Request) => Promise<Response>>();

  static async start(): Promise<SimServer> {
    const server = new SimServer();
    server.handle = await createTestDb();
    server.repos = await seedWorld(server.handle);
    server.sync = new DrizzleSyncStore(server.handle.db, server.repos);
    const replayer = server.loggingReplayer(new DrizzleProcedureReplayer(server.handle.db, server.repos));
    const sync = server.loggingSync(server.sync);
    for (const firm of FIRMS) {
      server.handlers.set(firm.org, createServerTrpcHandler({ repos: server.repos, ports: noopPorts, organizationId: firm.org, sync, replayer }));
    }
    return server;
  }

  /** Byråns handler — inloggningen (oauth2-proxy) sätter användarens e-post. */
  serve(u: SimUser, req: Request): Promise<Response> {
    const handler = this.handlers.get(firmOf(u.id).org);
    if (!handler) throw new Error(`ingen handler för ${u.email}`);
    const headers = new Headers(req.headers);
    headers.set("X-Auth-Request-Email", u.email);
    return handler(new Request(req, { headers }));
  }

  private record(outcome: ServerOutcome): void {
    const id = idOf(outcome);
    const accepted = outcome.status === "accepted" || outcome.status === "rebased";
    if (accepted && !this.applied.some((o) => idOf(o) === id)) this.applied.push(outcome);
    this.outcomes.set(id, outcome);
    this.log.push(outcome);
  }

  private loggingSync(inner: SyncStore): SyncStore {
    return {
      pull: (org, cursor) => inner.pull(org, cursor),
      rows: (org, refs) => inner.rows(org, refs),
      push: async (pusher, mutation) => {
        const res = await inner.push(pusher, mutation);
        this.record({ kind: "row", mutation, pusher, status: res.status, ...(res.status === "conflict" ? { reason: res.reason } : {}) });
        return res;
      },
    };
  }

  private loggingReplayer(inner: ProcedureReplayer): ProcedureReplayer {
    return {
      replay: async (call, ctx) => {
        const res = await inner.replay(call, ctx);
        this.record({
          kind: "procedure", call, userId: String(ctx.user?.id), org: String(ctx.user?.organizationId), status: res.status,
          ...(res.status === "rejected" ? { code: res.code } : {}),
        });
        return res;
      },
    };
  }
}

const AT = new Date(`${YEAR}-09-01T08:00:00.000Z`);

/** En byrås startläge: användare, ärenden, en kontakt, en tidspost, ett dokument och dess förslag. */
async function seedFirm(repos: DrizzleRepositories, firm: Firm): Promise<void> {
  await repos.organizations.create({ id: firm.org, name: `Byrå ${firm.key}` } as never);
  for (const u of firm.users) {
    // Via repona, så att raderna loggas i change_log och klienterna pullar dem.
    await repos.users.create({
      id: u.id, organizationId: firm.org, email: u.email, name: u.name, role: u.role, active: true, hourlyRate: 150_000,
      matterNumberPrefix: u.prefix ?? null,
    } as never);
  }
  for (const m of firm.matters) {
    await repos.matters.create({
      id: m.id, organizationId: firm.org, title: `Ärende ${m.number}`, status: "ACTIVE", matterNumber: m.number,
      paymentMethod: m.paymentMethod, responsibleLawyerId: m.responsible,
    } as never);
  }
  const [first] = firm.matters;
  const owner = firm.users[0]?.id;
  await repos.contacts.create({ id: firm.contact, organizationId: firm.org, name: `Klient ${firm.key}`, contactType: "PERSON" } as never);
  await repos.timeEntries.create({
    id: firm.timeEntry, matterId: first?.id, userId: owner, date: AT, minutes: 60, description: "Startpost", hourlyRate: 150_000, billable: true,
  } as never);
  await repos.documents.create({
    id: firm.document, organizationId: firm.org, matterId: first?.id, fileName: "kallelse.pdf", mimeType: "application/pdf",
    sizeBytes: 1, storagePath: `documents/content/${firm.document}`, uploadedById: owner,
  } as never);
  for (const [i, id] of firm.suggestions.entries()) {
    await repos.matterEventSuggestions.create({ id, documentId: firm.document, matterId: first?.id, title: `Förhandling ${i + 1}`, startAt: AT } as never);
  }
}

/** Båda byråerna. Samma i varje värld (för seriell omkörning). */
export async function seedWorld(handle: TestDbHandle): Promise<DrizzleRepositories> {
  const repos = buildDrizzleRepositories(handle.db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  for (const firm of FIRMS) await seedFirm(repos, firm);
  return repos;
}
