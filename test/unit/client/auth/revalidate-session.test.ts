/**
 * 401 vid synk (#1245, ADR 0018): sessionen omvalideras. Utloggad →
 * inloggningen; spärrat konto → besked och kön ligger kvar.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { ACCOUNT_REVOKED_MESSAGE, revalidateSession, SESSION_EXPIRED_MESSAGE } from "@/lib/client/auth/revalidate-session";
import { isUnauthorizedError } from "@/lib/client/auth/unauthorized";

const deps = (probe: unknown) => ({
  probe: vi.fn(async () => probe as never),
  redirect: vi.fn(),
  location: () => ({ pathname: "/ava/", search: "" }),
});

describe("revalidateSession", () => {
  it("sessionen gick ut → till inloggningen, med besked om att ändringarna finns kvar", async () => {
    const d = deps({ kind: "unauthenticated" });
    expect(await revalidateSession(d)).toBe(SESSION_EXPIRED_MESSAGE);
    expect(d.redirect).toHaveBeenCalledWith("/oauth2/start?rd=%2Fava%2F");
  });

  it("inloggad men servern vägrar → kontot är spärrat; ingen omdirigering", async () => {
    const d = deps({ kind: "ok", claims: { email: "a@b.se", subject: "", issuer: "", name: "" } });
    expect(await revalidateSession(d)).toBe(ACCOUNT_REVOKED_MESSAGE);
    expect(d.redirect).not.toHaveBeenCalled();
  });

  it("nås inte → inget särskilt besked (nästa synk försöker igen)", async () => {
    expect(await revalidateSession(deps({ kind: "unreachable" }))).toBeNull();
  });
});

describe("isUnauthorizedError", () => {
  it("tRPC-JSON från servern: httpStatus 401 eller koden UNAUTHORIZED", () => {
    expect(isUnauthorizedError({ data: { httpStatus: 401 } })).toBe(true);
    expect(isUnauthorizedError({ data: { code: "UNAUTHORIZED" } })).toBe(true);
  });

  it("en naken 401 från proxyn syns i meta.response", () => {
    expect(isUnauthorizedError({ meta: { response: { status: 401 } } })).toBe(true);
  });

  it("andra fel är inte 401", () => {
    expect(isUnauthorizedError(new Error("nätverk"))).toBe(false);
    expect(isUnauthorizedError({ data: { httpStatus: 500 } })).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});
