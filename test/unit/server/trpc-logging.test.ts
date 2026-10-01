/**
 * tRPC-loggningen (#1080).
 *
 * Det här är testet som avgör om loggningen är trovärdig. Ett fel som inte
 * loggas syns inte förrän någon ringer; en input som loggas är ett
 * sekretessbrott. Båda riktningarna vaktas här.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { z } from "zod";
import { setErrorReporter, type ErrorReport } from "@/lib/server/observability/error-reporter";
import { publicProcedure, router, TRPCError, type Context } from "@/lib/server/trpc-core";
import { arraySink, setLogLevel, setLogSink, type LogRecord } from "@/lib/shared/observability/logger";
import { mockStoreAndRepos } from "./helpers/mock-data-store";

let records: LogRecord[] = [];
let reports: ErrorReport[] = [];
let restore: ReturnType<typeof setLogSink>;
let restoreReporter: ReturnType<typeof setErrorReporter>;

beforeEach(() => {
  records = [];
  reports = [];
  restore = setLogSink(arraySink(records));
  restoreReporter = setErrorReporter((r) => void reports.push(r));
  setLogLevel("debug");
});
afterEach(() => {
  setLogSink(restore);
  setErrorReporter(restoreReporter);
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
  crash: publicProcedure
    .input(z.object({ personnummer: z.string() }))
    .query(({ input }): never => {
      throw new TypeError(`Klienten ${input.personnummer} kraschade`);
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

describe("felrapporteringen (#1343)", () => {
  const user = { id: "u-1", email: "a@b.se", name: "A", role: "LAWYER", organizationId: "org-1" };

  it("ett klientfel (4xx) rapporteras inte", async () => {
    await expect(caller().boom(HEMLIGT)).rejects.toThrow();
    expect(reports).toHaveLength(0);
  });

  it("ett valideringsfel rapporteras inte", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- avsiktligt fel form
    await expect(caller().ok({ fel: "form" } as any)).rejects.toThrow();
    expect(reports).toHaveLength(0);
  });

  it("ett oväntat serverfel rapporteras med klass, path och samma requestId som loggen", async () => {
    await expect(caller(user as Context["user"]).crash(HEMLIGT)).rejects.toThrow();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ type: "TypeError", path: "crash", requestId: records[0]?.requestId });
  });

  it("rapporten bär varken meddelande, input eller användarens och orgens id", async () => {
    await expect(caller(user as Context["user"]).crash(HEMLIGT)).rejects.toThrow();
    const json = JSON.stringify(reports);
    for (const secret of [HEMLIGT.personnummer, "kraschade", "u-1", "org-1", "a@b.se"]) expect(json).not.toContain(secret);
  });
});
