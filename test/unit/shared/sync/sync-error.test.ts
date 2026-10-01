/**
 * Klassningen av fel vid uppspelning av en köpost (#1353): avvisa, försök
 * igen (begränsat) eller stanna utan att räkna.
 */
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { classifySyncError, httpStatusOf, syncErrorMessage, trpcCodeOf, type SyncErrorClass } from "@/lib/shared/sync/sync-error";

/** Ett tRPC-klientfel med JSON-svar från servern. */
const trpc = (code: string, httpStatus: number): Error =>
  Object.assign(new Error(code), { name: "TRPCClientError", data: { code, httpStatus } });

/** Proxyns nakna svar (oauth2-proxy/nginx) — ingen tRPC-kod. */
const proxy = (status: number): Error =>
  Object.assign(new Error(`HTTP ${status}`), { name: "TRPCClientError", meta: { response: { status } } });

describe("classifySyncError", () => {
  it.each<[string, SyncErrorClass]>([
    ["BAD_REQUEST", "reject"], ["PARSE_ERROR", "reject"], ["NOT_FOUND", "reject"], ["FORBIDDEN", "reject"],
    ["CONFLICT", "reject"], ["PRECONDITION_FAILED", "reject"], ["PAYLOAD_TOO_LARGE", "reject"],
    ["UNPROCESSABLE_CONTENT", "reject"], ["UNSUPPORTED_MEDIA_TYPE", "reject"], ["METHOD_NOT_SUPPORTED", "reject"],
    ["UNAUTHORIZED", "halt"], ["TOO_MANY_REQUESTS", "halt"], ["NOT_IMPLEMENTED", "halt"],
    ["BAD_GATEWAY", "halt"], ["SERVICE_UNAVAILABLE", "halt"],
    ["INTERNAL_SERVER_ERROR", "retry"], ["TIMEOUT", "retry"], ["GATEWAY_TIMEOUT", "retry"], ["CLIENT_CLOSED_REQUEST", "retry"],
  ])("tRPC-koden %s → %s", (code, expected) => {
    expect(classifySyncError(trpc(code, 0))).toBe(expected);
  });

  it.each<[number, SyncErrorClass]>([
    [400, "reject"], [404, "reject"], [413, "reject"], [422, "reject"],
    [401, "halt"], [429, "halt"], [501, "halt"], [502, "halt"], [503, "halt"],
    [408, "retry"], [499, "retry"], [500, "retry"], [504, "retry"],
  ])("proxyns HTTP %i utan tRPC-kod → %s", (status, expected) => {
    expect(classifySyncError(proxy(status))).toBe(expected);
  });

  it("ett zod-fel är deterministiskt → reject", () => {
    const parsed = z.object({ id: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    expect(classifySyncError(parsed.error)).toBe("reject");
  });

  it("ett tRPC-klientfel utan svar (nätet nås inte) → halt", () => {
    expect(classifySyncError(Object.assign(new Error("Failed to fetch"), { name: "TRPCClientError" }))).toBe("halt");
  });

  it("ett okänt fel → retry (räknas mot gränsen)", () => {
    expect(classifySyncError(new TypeError("x is undefined"))).toBe("retry");
    expect(classifySyncError("sträng")).toBe("retry");
    expect(classifySyncError(null)).toBe("retry");
  });
});

describe("httpStatusOf / trpcCodeOf", () => {
  it("läser JSON-svaret före proxyns, och ger undefined när inget finns", () => {
    expect(httpStatusOf(trpc("NOT_FOUND", 404))).toBe(404);
    expect(httpStatusOf(proxy(502))).toBe(502);
    expect(httpStatusOf(new Error("x"))).toBeUndefined();
    expect(httpStatusOf({ data: { httpStatus: "500" } })).toBeUndefined();
    expect(trpcCodeOf(trpc("CONFLICT", 409))).toBe("CONFLICT");
    expect(trpcCodeOf({ data: { code: 409 } })).toBeUndefined();
    expect(trpcCodeOf(undefined)).toBeUndefined();
  });
});

describe("syncErrorMessage", () => {
  it("ett Errors text; annat som sträng", () => {
    expect(syncErrorMessage(new Error("nätet"))).toBe("nätet");
    expect(syncErrorMessage(42)).toBe("42");
  });

  it("kortas till 300 tecken", () => {
    const text = syncErrorMessage(new Error("x".repeat(1000)));
    expect(text).toHaveLength(300);
    expect(text.endsWith("…")).toBe(true);
  });
});
