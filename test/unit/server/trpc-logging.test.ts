/**
 * tRPC-loggningen (#1080).
 *
 * Det här är testet som avgör om loggningen är trovärdig. Ett fel som inte
 * loggas syns inte förrän någon ringer; en input som loggas är ett
 * sekretessbrott. Båda riktningarna vaktas här.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { z } from "zod";
import { publicProcedure, router, TRPCError, type Context } from "@/lib/server/trpc-core";
import { arraySink, setLogLevel, setLogSink, type LogRecord } from "@/lib/shared/observability/logger";
import { mockStoreAndRepos } from "./helpers/mock-data-store";

let records: LogRecord[] = [];
let restore: ReturnType<typeof setLogSink>;

beforeEach(() => {
  records = [];
  restore = setLogSink(arraySink(records));
  setLogLevel("debug");
});
afterEach(() => {
  setLogSink(restore);
  setLogLevel("info");
});

/** Minsta möjliga router med en lyckad och en fallerande procedur. */
const testRouter = router({
  ok: publicProcedure
    .input(z.object({ personnummer: z.string(), klientnamn: z.string() }))
    .query(() => ({ done: true })),
  boom: publicProcedure
    .input(z.object({ personnummer: z.string() }))
    .query(({ input }) => {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Klienten ${input.personnummer} saknar fullmakt` });
    }),
});

function caller(user: Context["user"] = null) {
  const { dataStore, repos } = mockStoreAndRepos({});
  return testRouter.createCaller({
    dataStore, repos, user,
    ports: {} as Context["ports"],
  });
}

const HEMLIGT = { personnummer: "19670312-4521", klientnamn: "Anna Andersson" };

describe("lyckat anrop", () => {
  it("loggar path, utfall och varaktighet", async () => {
    await caller().ok(HEMLIGT);
    expect(records[0]).toMatchObject({ event: "trpc.query", path: "ok", outcome: "ok" });
    expect(typeof records[0]?.durationMs).toBe("number");
  });

  it("får ett requestId även utan HTTP-lager", async () => {
    await caller().ok(HEMLIGT);
    expect(records[0]?.requestId).toHaveLength(12);
  });

  it("bär användarens och orgens id när någon är inloggad", async () => {
    const user = { id: "u-1", email: "a@b.se", name: "A", role: "LAWYER", organizationId: "org-1" };
    await caller(user as Context["user"]).ok(HEMLIGT);
    expect(records[0]).toMatchObject({ userId: "u-1", orgId: "org-1" });
  });
});

describe("inputen loggas ALDRIG", () => {
  // Strukturen är första försvaret: LogRecord har inget fält att hälla en
  // input i. Det här testet bevisar att försvaret håller i praktiken, inte
  // bara i typsystemet.
  it.each([["personnummer", HEMLIGT.personnummer], ["klientnamn", HEMLIGT.klientnamn]])(
    "%s finns inte någonstans i loggen", async (_label, secret) => {
      await caller().ok(HEMLIGT);
      expect(JSON.stringify(records)).not.toContain(secret);
    });

  it("inte heller när anropet fallerar", async () => {
    await expect(caller().boom(HEMLIGT)).rejects.toThrow();
    expect(JSON.stringify(records)).not.toContain(HEMLIGT.personnummer);
  });
});

describe("fallerat anrop", () => {
  it("loggas som error med felkoden", async () => {
    await expect(caller().boom(HEMLIGT)).rejects.toThrow();
    expect(records[0]).toMatchObject({ level: "error", outcome: "error", code: "BAD_REQUEST" });
  });

  // Felmeddelandet är vägen strukturskyddet inte täcker: en domänregel kan
  // mycket väl formulera sig med klientens personnummer i.
  it("felmeddelandet är maskerat men fortfarande läsbart", async () => {
    await expect(caller().boom(HEMLIGT)).rejects.toThrow();
    expect(records[0]?.message).toContain("saknar fullmakt");
    expect(records[0]?.message).toContain("maskerat");
  });

  it("felet kastas vidare oförändrat — loggen sväljer inget", async () => {
    await expect(caller().boom(HEMLIGT)).rejects.toThrow(/19670312-4521/);
  });

  // Ett valideringsfel når aldrig proceduren, men användaren ser ändå ett fel.
  it("loggar även fel från input-valideringen", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- avsiktligt fel form
    await expect(caller().ok({ fel: "form" } as any)).rejects.toThrow();
    expect(records[0]).toMatchObject({ outcome: "error", code: "BAD_REQUEST" });
  });
});
