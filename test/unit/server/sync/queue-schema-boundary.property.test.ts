/**
 * Gränsen mellan klient och server i synken (#1849): servern tar emot allt
 * klienten kan köa. En glidning mellan scheman gav tidigare ett fel där en
 * köad ändring avvisades av servern och backades lokalt (#1674).
 *
 * Posterna byggs genom klientens riktiga vägar (`MutationQueue.enqueue`,
 * `enqueueProcedure`, `requeue`) och enhetsrapporten genom
 * `buildDeviceReport`, och prövas mot serverns inschema, läst ur
 * `appRouter._def.procedures` (samma router som servern kör).
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { buildDeviceReport } from "@/lib/client/backend/sync-device-report";
import {
  InMemoryMutationQueuePersistence, isProcedureCall, MutationQueue, queueOwnerSchema, type QueueEntry, type QueueOwner,
} from "@/lib/client/local-store/mutation-queue";
import { MAX_PROCEDURE_TOUCHES } from "@/lib/server/data-store/in-memory/procedure-touches";
import { appRouter } from "@/lib/server/routers/_app";
import { ROW_PUSH_POLICY } from "@/lib/server/sync/row-push-policy";
import { QUEUED_PROCEDURES } from "@/lib/shared/sync/queued-procedures";
import { syncErrorMessage } from "@/lib/shared/sync/sync-error";
import { uuidv7 } from "@/lib/shared/uuid";

/** Procedurens inschema ur tRPC:s `_def` (otypad i routerns union). */
const procedureDef = z.object({ inputs: z.array(z.custom<z.ZodType>((v) => v instanceof z.ZodType)) });

function serverInput(path: string): z.ZodType {
  const procedure = Object.entries(appRouter._def.procedures).find(([p]) => p === path)?.[1];
  const input = procedureDef.parse(procedure && "_def" in procedure ? procedure._def : undefined).inputs[0];
  if (!input) throw new Error(`${path} saknar inschema`);
  return input;
}

const pushInput = serverInput("sync.push");
const replayInput = serverInput("sync.replay");
const reportInput = serverInput("sync.reportDevice");

/** Felen om serverns schema för postens väg avvisar den (tomt = tas emot). */
function serverIssues(entry: QueueEntry): z.core.$ZodIssue[] {
  const schema = isProcedureCall(entry) ? replayInput : pushInput;
  return schema.safeParse(entry).error?.issues ?? [];
}

const ROW_ENTITIES = Object.keys(ROW_PUSH_POLICY);
const PROCEDURE_PATHS = Object.keys(QUEUED_PROCEDURES);
const ENTITIES = [...new Set([...ROW_ENTITIES, ...Object.values(QUEUED_PROCEDURES).map((spec) => spec.entity)])];

const row = fc.dictionary(fc.string({ maxLength: 20 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 6 });
const now = fc.integer({ min: 0, max: 2 ** 42 });
const owner: fc.Arbitrary<QueueOwner | undefined> = fc.option(
  fc.record({ principalId: fc.string({ minLength: 1, maxLength: 60 }), organizationId: fc.string({ minLength: 1, maxLength: 60 }) })
    .map((o) => queueOwnerSchema.parse(o)),
  { nil: undefined },
);

/** En radändring så som `LocalStore` köar den: create utan, update/delete med föregående rad. */
const rowEvent = fc.record({
  entity: fc.constantFrom(...ROW_ENTITIES),
  kind: fc.constantFrom("create" as const, "update" as const, "delete" as const),
  row,
  previous: row,
  baseVersion: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: undefined }),
  now,
});

/** Ett procedur-anrop med 0 till `MAX_PROCEDURE_TOUCHES` rörda rader. */
const procedureCall = fc.record({
  path: fc.constantFrom(...PROCEDURE_PATHS),
  input: row,
  touchCount: fc.oneof(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: MAX_PROCEDURE_TOUCHES })),
  entity: fc.constantFrom(...ENTITIES),
  id: fc.string({ maxLength: 100 }),
  now,
});

function touchesFor(count: number, entity: string, id: string): Array<{ entity: string; id: string }> {
  return Array.from({ length: count }, (_, i) => ({ entity, id: i === 0 ? id : uuidv7() }));
}

describe("servern tar emot allt klienten kan köa (#1849)", () => {
  it("radposter för varje entitet i ROW_PUSH_POLICY, med och utan ägare", async () => {
    await fc.assert(fc.asyncProperty(rowEvent, owner, async (e, who) => {
      const queue = new MutationQueue(new InMemoryMutationQueuePersistence(), who);
      const previous = e.kind === "create" ? undefined : e.previous;
      const entry = await queue.enqueue({ entity: e.entity, kind: e.kind, row: e.row, ...(previous ? { previous } : {}) }, { ...(e.baseVersion === undefined ? {} : { baseVersion: e.baseVersion }), now: e.now });
      expect(serverIssues(entry)).toEqual([]);
    }), { numRuns: 200 });
  });

  it("procedur-anrop för varje sökväg i QUEUED_PROCEDURES, med och utan ägare", async () => {
    await fc.assert(fc.asyncProperty(procedureCall, owner, async (c, who) => {
      const queue = new MutationQueue(new InMemoryMutationQueuePersistence(), who);
      const entry = await queue.enqueueProcedure({ path: c.path, input: c.input, touches: touchesFor(c.touchCount, c.entity, c.id) }, { now: c.now });
      expect(serverIssues(entry)).toEqual([]);
    }), { numRuns: 100 });
  });

  it("en post som läggs tillbaka (requeue) tas emot som förut", async () => {
    await fc.assert(fc.asyncProperty(rowEvent, procedureCall, owner, async (e, c, who) => {
      const queue = new MutationQueue(new InMemoryMutationQueuePersistence(), who);
      const rowEntry = await queue.enqueue({ entity: e.entity, kind: e.kind, row: e.row }, { now: e.now });
      const call = await queue.enqueueProcedure({ path: c.path, input: c.input, touches: touchesFor(Math.min(c.touchCount, 5), c.entity, c.id) }, { now: c.now });
      await queue.ack(rowEntry.mutationId);
      await queue.ack(call.mutationId);
      await queue.requeue(rowEntry);
      await queue.requeue(call);
      expect(queue.pending()).toHaveLength(2);
      for (const entry of queue.pending()) expect(serverIssues(entry)).toEqual([]);
    }), { numRuns: 50 });
  });

  it("varje enhetsrapport klienten kan bygga, också med fel över 300 tecken", () => {
    const lastError = fc.option(fc.string({ maxLength: 1000 }).map((text) => syncErrorMessage(new Error(text))), { nil: null });
    const store = fc.record({ pending: fc.nat(), oldest: fc.option(fc.nat(), { nil: null }) });
    fc.assert(fc.property(store, fc.string({ maxLength: 400 }), lastError, (s, userAgent, err) => {
      const report = buildDeviceReport({ pendingCount: () => s.pending, oldestPendingAt: () => s.oldest }, userAgent, err, uuidv7());
      expect(reportInput.safeParse(report).error?.issues ?? []).toEqual([]);
    }), { numRuns: 300 });
  });
});
