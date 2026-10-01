/**
 * `newRowId` / `callTime` (#1276) — ett köat anrop ger samma id och datum i
 * klientens körning och serverns omkörning; utanför kön som förut.
 */
import { describe, expect, it } from "vitest-compat";
import { boundedCallTime, callTime, dateOrCallTime, MAX_CALL_AGE_MS, newRowId } from "@/lib/server/queued-call";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isUuid } from "@/lib/shared/uuid";

const queued = { mutationId: "01928f3a-1b2c-7d4e-8f00-112233445566", at: Date.UTC(2026, 0, 2, 9, 30) };

describe("queued-call", () => {
  it("i ett köat anrop: id härlett ur anropets id och rollen", () => {
    expect(newRowId({ queued }, "payment")).toBe(derivedId(queued.mutationId, "payment"));
  });

  it("utanför kön: ett nytt uuid varje gång", () => {
    const a = newRowId({}, "payment");
    expect(isUuid(a)).toBe(true);
    expect(newRowId({}, "payment")).not.toBe(a);
  });

  it("i ett köat anrop: tiden är när anropet gjordes, inte nu", () => {
    expect(callTime({ queued }).getTime()).toBe(queued.at);
  });

  it("utanför kön: nu", () => {
    const before = Date.now();
    expect(callTime({}).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("datum ur input vinner; saknas det → när anropet gjordes", () => {
    expect(dateOrCallTime({ queued }, "2026-03-04").toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(dateOrCallTime({ queued }, undefined).getTime()).toBe(queued.at);
  });

  describe("boundedCallTime (#1350): klientens anropstid begränsas till [nu − 30 dagar, nu]", () => {
    const now = Date.UTC(2026, 9, 1, 12, 0);

    it("inom fönstret: oförändrad", () => {
      expect(boundedCallTime(now - 86_400_000, now)).toBe(now - 86_400_000);
      expect(boundedCallTime(now, now)).toBe(now);
    });

    it("i framtiden → nu", () => {
      expect(boundedCallTime(now + 5 * 60_000, now)).toBe(now);
    });

    it("äldre än 30 dagar → nu − 30 dagar", () => {
      expect(boundedCallTime(0, now)).toBe(now - MAX_CALL_AGE_MS);
      expect(MAX_CALL_AGE_MS).toBe(30 * 86_400_000);
    });
  });
});
