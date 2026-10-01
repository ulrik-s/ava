/**
 * Vilka fel som får lämna servern, och i vilken form (#1343).
 *
 * Två riktningar vaktas: ett klientfel (4xx) rapporteras aldrig, och en
 * rapport bär aldrig fri text — inget meddelande, inga personuppgifter.
 */

import { TRPCError } from "@trpc/server";
import { describe, it, expect, afterEach } from "vitest-compat";
import {
  reportableError, reportError, setErrorReporter, toErrorReport, type ErrorReport,
} from "@/lib/server/observability/error-reporter";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const CTX = { path: "invoice.create", requestId: "ABC234DEF567" };
const HEMLIGT = "Klienten Anna Andersson (19670312-4521) anna@example.se";

describe("reportableError", () => {
  it.each(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "PRECONDITION_FAILED", "TOO_MANY_REQUESTS"] as const)(
    "%s (4xx) rapporteras inte", (code) => {
      expect(reportableError(new TRPCError({ code, message: HEMLIGT }))).toBeNull();
    });

  it("ett internt fel rapporteras som sin orsak", () => {
    const cause = new TypeError("x");
    expect(reportableError(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }))).toEqual({ target: cause });
  });

  it("ett 5xx utan orsak rapporteras som sig självt", () => {
    const e = new TRPCError({ code: "SERVICE_UNAVAILABLE" });
    expect(reportableError(e)?.target).toBe(e);
  });

  it("ett fel som inte är TRPCError rapporteras som det är", () => {
    const e = new Error("x");
    expect(reportableError(e)?.target).toBe(e);
  });

  it("även ett kastat null rapporteras", () => {
    expect(reportableError(null)).toEqual({ target: null });
  });
});

describe("toErrorReport", () => {
  it("bär klass, kod, path, requestId, tid och ramar — inget annat", () => {
    const cause = Object.assign(new Error(HEMLIGT), { name: "PostgresError", code: "23505", detail: HEMLIGT });
    const report = toErrorReport(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: HEMLIGT, cause }), CTX, NOW);
    expect(report && Object.keys(report).sort()).toEqual(["errorCode", "frames", "path", "requestId", "timestamp", "type"]);
    expect(report).toMatchObject({
      timestamp: NOW.toISOString(), type: "PostgresError", errorCode: "23505", path: "invoice.create", requestId: "ABC234DEF567",
    });
    expect(report?.frames.length).toBeGreaterThan(0);
  });

  it("meddelandet och personuppgifterna finns inte någonstans i rapporten", () => {
    const report = toErrorReport(new Error(HEMLIGT), CTX, NOW);
    const json = JSON.stringify(report);
    for (const secret of ["Anna", "19670312-4521", "anna@example.se", "Klienten"]) expect(json).not.toContain(secret);
  });

  it("4xx ger ingen rapport", () => {
    expect(toErrorReport(new TRPCError({ code: "FORBIDDEN" }), CTX)).toBeNull();
  });

  it("en felkod i fritext-form, en klass med konstigt namn och fel form på kontexten tas bort", () => {
    const e = Object.assign(new Error("x"), { name: "Klienten Anna", code: "kunde inte hitta Anna" });
    const report = toErrorReport(e, { path: "a b", requestId: "id med mellanslag" }, NOW);
    expect(report).toEqual({ timestamp: NOW.toISOString(), type: "Error", frames: report?.frames });
  });

  it.each([
    ["en sträng", "Anna Andersson"],
    ["null", null],
    ["ett objekt med numerisk kod", { code: 500 }],
  ])("%s kastat rapporteras som NonError utan text", (_label, thrown) => {
    const report = toErrorReport(thrown, {}, NOW);
    expect(report).toEqual({ timestamp: NOW.toISOString(), type: "NonError", frames: [] });
  });

  it("utan angiven tid används nu", () => {
    const report = toErrorReport(new Error("x"), {});
    expect(Date.parse(report?.timestamp ?? "")).not.toBeNaN();
  });
});

describe("reportError", () => {
  let restore: ReturnType<typeof setErrorReporter> | undefined;
  afterEach(() => { if (restore) setErrorReporter(restore); restore = undefined; });

  function capture(): ErrorReport[] {
    const got: ErrorReport[] = [];
    restore = setErrorReporter((r) => void got.push(r));
    return got;
  }

  it("skickar serverfel till mottagaren", () => {
    const got = capture();
    reportError(new Error("x"), CTX);
    expect(got).toHaveLength(1);
    expect(got[0]?.path).toBe("invoice.create");
  });

  it("skickar inte 4xx", () => {
    const got = capture();
    reportError(new TRPCError({ code: "BAD_REQUEST", message: HEMLIGT }), CTX);
    expect(got).toHaveLength(0);
  });

  it("en mottagare som kastar fäller inte anroparen", () => {
    restore = setErrorReporter(() => { throw new Error("trasig"); });
    expect(() => reportError(new Error("x"), CTX)).not.toThrow();
  });

  it("utan mottagare görs ingenting (default)", () => {
    expect(() => reportError(new Error("x"), CTX)).not.toThrow();
  });

  it("setErrorReporter returnerar den förra", () => {
    const mine = (): void => {};
    const previous = setErrorReporter(mine);
    expect(setErrorReporter(previous)).toBe(mine);
  });
});
