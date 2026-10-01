/**
 * 401 vid synk (#1245, #1351, ADR 0018): serverns skäl avgör, annars frågas
 * proxyn. Utgången session/token → "Logga in igen"; spärrat konto → besked och
 * kön ligger kvar.
 */
import { describe, expect, it, vi } from "vitest-compat";
import {
  ACCOUNT_REVOKED_MESSAGE, IDENTITY_SWITCH_MESSAGE, revalidateSession, SESSION_EXPIRED_MESSAGE, TOKEN_EXPIRED_MESSAGE,
} from "@/lib/client/auth/revalidate-session";
import { isUnauthorizedError } from "@/lib/client/auth/unauthorized";

const deps = (probe: unknown, boundEmail: string | null = "a@b.se") => ({
  probe: vi.fn(async () => probe as never),
  notify: vi.fn(),
  boundEmail,
  reload: vi.fn(),
});
const signedIn = { kind: "authenticated", claims: { email: "a@b.se", subject: "", issuer: "", name: "" } };

describe("revalidateSession", () => {
  // #1351: ingen hård omdirigering — bannern låter användaren välja när.
  it("proxyn har ingen session → 'Logga in igen', ingen omdirigering", async () => {
    const d = deps({ kind: "signed-out" });
    expect(await revalidateSession(d, null)).toBe(SESSION_EXPIRED_MESSAGE);
    expect(d.notify).toHaveBeenCalledWith("signed-out");
  });

  it("servern säger att kontot inte är aktivt → karantän-beskedet, utan att fråga proxyn", async () => {
    const d = deps(signedIn);
    expect(await revalidateSession(d, "account-inactive")).toBe(ACCOUNT_REVOKED_MESSAGE);
    expect(d.probe).not.toHaveBeenCalled();
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("servern säger att token gått ut → 'Logga in igen', inte 'kontot spärrat'", async () => {
    const d = deps(signedIn);
    expect(await revalidateSession(d, "token-expired")).toBe(TOKEN_EXPIRED_MESSAGE);
    expect(d.notify).toHaveBeenCalledWith("token-expired");
    expect(d.probe).not.toHaveBeenCalled();
  });

  it("proxyn släpper igenom men servern vägrar utan skäl → token duger inte; aldrig 'kontot spärrat'", async () => {
    const d = deps(signedIn);
    expect(await revalidateSession(d, null)).toBe(TOKEN_EXPIRED_MESSAGE);
    expect(await revalidateSession(d, "no-identity")).toBe(TOKEN_EXPIRED_MESSAGE);
  });

  // #1404: någon annan loggade in i en annan flik — proxyns cookie byttes.
  it("proxyn släpper igenom som någon annan än den bundna → sidan laddas om, varken 'Logga in igen' eller 'kontot spärrat'", async () => {
    const d = deps({ kind: "authenticated", claims: { email: "bo@b.se", subject: "", issuer: "", name: "" } });
    expect(await revalidateSession(d, null)).toBe(IDENTITY_SWITCH_MESSAGE);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("samma identitet i annat skiftläge, eller ingen bunden användare → ingen omladdning", async () => {
    const same = deps({ kind: "authenticated", claims: { email: " A@B.se ", subject: "", issuer: "", name: "" } });
    expect(await revalidateSession(same, null)).toBe(TOKEN_EXPIRED_MESSAGE);
    const unbound = deps({ kind: "authenticated", claims: { email: "bo@b.se", subject: "", issuer: "", name: "" } }, null);
    expect(await revalidateSession(unbound, null)).toBe(TOKEN_EXPIRED_MESSAGE);
    expect(same.reload).not.toHaveBeenCalled();
    expect(unbound.reload).not.toHaveBeenCalled();
  });

  it("nås inte → inget särskilt besked (nästa synk försöker igen)", async () => {
    const d = deps({ kind: "unreachable", reason: "network" });
    expect(await revalidateSession(d, null)).toBeNull();
    expect(d.notify).not.toHaveBeenCalled();
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
