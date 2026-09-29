/**
 * Sessionsgrinden (#1245, ADR 0018) — app-skalet laddas utan inloggning, och
 * klienten avgör vid varje start om användaren får arbeta.
 */
import { describe, expect, it } from "vitest-compat";
import { decideSessionGate, loginUrl, offlineGateMessage, type CachedIdentity } from "@/lib/client/auth/session-gate";
import { DEFAULT_OFFLINE_GRACE_MS } from "@/lib/shared/offline-grace";

const NOW = Date.UTC(2026, 8, 30, 8, 0);
const DAY = 24 * 60 * 60 * 1000;
const claims = { email: "Lena@Byra.se", subject: "", issuer: "", name: "Lena" };
const cached = (verifiedAt: number | undefined): CachedIdentity => ({ principalId: "u1", email: "lena@byra.se", verifiedAt });

describe("decideSessionGate", () => {
  it("inloggad med samma identitet → fortsätt, och sessionen räknas som verifierad nu", () => {
    expect(decideSessionGate({ kind: "ok", claims }, cached(NOW - 3 * DAY), NOW)).toEqual({ kind: "proceed", verifiedNow: true });
  });

  it("inloggad men ingen (eller en annan) identitet bunden → bind", () => {
    expect(decideSessionGate({ kind: "ok", claims }, null, NOW)).toEqual({ kind: "bind", claims });
    const other = { ...cached(NOW), email: "annan@byra.se" };
    expect(decideSessionGate({ kind: "ok", claims }, other, NOW)).toEqual({ kind: "bind", claims });
  });

  it("utloggad → till inloggningen", () => {
    expect(decideSessionGate({ kind: "unauthenticated" }, cached(NOW), NOW)).toEqual({ kind: "login" });
  });

  it("servern nås inte, inom grace → arbeta vidare offline under den cachade identiteten", () => {
    expect(decideSessionGate({ kind: "unreachable" }, cached(NOW - 6 * DAY), NOW)).toEqual({ kind: "proceed", verifiedNow: false });
    expect(decideSessionGate({ kind: "unreachable" }, cached(NOW - DEFAULT_OFFLINE_GRACE_MS), NOW).kind).toBe("proceed");
  });

  it("servern nås inte, grace utgången eller aldrig verifierad → kräver uppkoppling", () => {
    expect(decideSessionGate({ kind: "unreachable" }, cached(NOW - 8 * DAY), NOW)).toEqual({ kind: "offline-expired" });
    expect(decideSessionGate({ kind: "unreachable" }, cached(undefined), NOW)).toEqual({ kind: "offline-expired" });
  });

  it("servern nås inte och ingen har loggat in på enheten → kräver uppkoppling", () => {
    expect(decideSessionGate({ kind: "unreachable" }, null, NOW)).toEqual({ kind: "offline-unbound" });
  });

  it("grace-tiden kan ställas per byrå", () => {
    expect(decideSessionGate({ kind: "unreachable" }, cached(NOW - 2 * DAY), NOW, DAY)).toEqual({ kind: "offline-expired" });
  });

  it("ingen OIDC i driften (basic-auth) → som förut", () => {
    expect(decideSessionGate({ kind: "absent" }, null, NOW)).toEqual({ kind: "proceed", verifiedNow: false });
  });
});

describe("loginUrl / offlineGateMessage", () => {
  it("inloggningen tar användaren tillbaka dit hen var", () => {
    expect(loginUrl({ pathname: "/ava/matters/", search: "?q=a b" })).toBe("/oauth2/start?rd=%2Fava%2Fmatters%2F%3Fq%3Da%20b");
  });

  it("beskeden säger vad användaren ska göra", () => {
    expect(offlineGateMessage({ kind: "offline-expired" })).toMatch(/Anslut till nätet.*lokala ändringar finns kvar/);
    expect(offlineGateMessage({ kind: "offline-unbound" })).toMatch(/uppkopplad första gången/);
  });
});
