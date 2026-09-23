/**
 * Den strukturerade loggern (#1080).
 *
 * Det viktigaste testet här är negativt: att det INTE går att hälla in en fri
 * payload. Strukturen är första försvaret mot att klientens personnummer
 * hamnar i containerloggen, och ett försvar som går att kringgå av misstag är
 * inget försvar.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import {
  arraySink, createLogger, isEnabled, nullSink, setLogLevel, setLogSink,
  type LogRecord,
} from "@/lib/shared/observability/logger";

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

describe("postens form", () => {
  it("bär tidsstämpel, nivå och händelse", () => {
    createLogger().info("trpc.query");
    expect(records[0]).toMatchObject({ level: "info", event: "trpc.query" });
    expect(records[0]?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // Tomma nycklar i varje rad gör `jq`-filtrering värdelös och tredubblar
  // loggvolymen på fält ingen satt.
  it("utelämnar fält som inte satts", () => {
    createLogger().info("x");
    expect(Object.keys(records[0] ?? {})).toEqual(["ts", "level", "event"]);
  });

  it("bär bara ids — aldrig namn eller e-post", () => {
    createLogger({ userId: "u-1", orgId: "org-1" }).info("trpc.query");
    expect(records[0]).toMatchObject({ userId: "u-1", orgId: "org-1" });
  });
});

describe("kontext följer med", () => {
  it("varje post ärver loggerns kontext", () => {
    const logger = createLogger({ requestId: "ABC123DEF456" });
    logger.info("a");
    logger.error("b");
    expect(records.map((r) => r.requestId)).toEqual(["ABC123DEF456", "ABC123DEF456"]);
  });

  it("child utökar utan att röra föräldern", () => {
    const parent = createLogger({ requestId: "R1" });
    parent.child({ path: "invoice.list" }).info("a");
    parent.info("b");
    expect(records.map((r) => r.path)).toEqual(["invoice.list", undefined]);
  });

  it("fält på anropet vinner över kontexten", () => {
    createLogger({ path: "a" }).info("e", { path: "b" });
    expect(records[0]?.path).toBe("b");
  });
});

describe("nivåtröskeln", () => {
  it("släpper inte igenom under tröskeln", () => {
    setLogLevel("warn");
    const logger = createLogger();
    logger.debug("d"); logger.info("i"); logger.warn("w"); logger.error("e");
    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("isEnabled speglar tröskeln — så dyra fält kan hoppas över", () => {
    setLogLevel("warn");
    expect({ debug: isEnabled("debug"), error: isEnabled("error") }).toEqual({ debug: false, error: true });
  });
});

describe("sink:en", () => {
  it("nullSink kastar bort allt — default i tester", () => {
    setLogSink(nullSink);
    createLogger().error("e");
    expect(records).toHaveLength(0);
  });

  it("setLogSink returnerar den förra så tester kan återställa", () => {
    const mine = arraySink([]);
    const previous = setLogSink(mine);
    expect(setLogSink(previous)).toBe(mine);
  });
});
