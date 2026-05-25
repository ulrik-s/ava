/**
 * Tester för auth-server:s pure-helpers. Vi vill kunna ändra
 * htpasswd-formatet eller invite-livscykeln utan att gissa hur de
 * beter sig.
 */

import { describe, it, expect } from "vitest";
// .mjs utan d.ts — TS implicit-any på import:n, vi castar till any nedan
 
import * as core from "../../../tooling/docker/auth-server/auth-core.mjs";

const {
  hashToken, safeEqual, newToken,
  parseHtpasswd, serializeHtpasswd, upsertHtpasswd,
  createInvite, findValidInvite, redeemInvite, hasAdmin,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} = core as any;

describe("hashToken / safeEqual", () => {
  it("hashToken är deterministisk", () => {
    expect(hashToken("hej")).toBe(hashToken("hej"));
    expect(hashToken("hej")).not.toBe(hashToken("hej2"));
  });

  it("hashToken börjar med {SHA} (nginx-kompatibelt format)", () => {
    expect(hashToken("anything")).toMatch(/^\{SHA\}/);
  });

  it("safeEqual returnerar true för identiska strängar, false annars", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("newToken", () => {
  it("genererar URL-säker base64url-token ~43 chars", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it("två anrop ger olika tokens", () => {
    expect(newToken()).not.toBe(newToken());
  });
});

describe("parse/serializeHtpasswd", () => {
  it("round-trips", () => {
    const content = "anna:hash1\nbjorn:hash2\n";
    const map = parseHtpasswd(content);
    expect(map.get("anna")).toBe("hash1");
    expect(map.get("bjorn")).toBe("hash2");
    expect(serializeHtpasswd(map)).toBe(content);
  });

  it("ignorerar kommentarer + tomma rader", () => {
    const map = parseHtpasswd("# comment\n\nanna:h\n");
    expect(map.size).toBe(1);
  });
});

describe("upsertHtpasswd", () => {
  it("lägger till ny användare utan att mutera input", () => {
    const orig = parseHtpasswd("anna:h\n");
    const next = upsertHtpasswd(orig, "bjorn", "secret-token");
    expect(orig.has("bjorn")).toBe(false);
    expect(next.has("bjorn")).toBe(true);
    expect(next.get("bjorn")).toMatch(/^\{SHA\}/);
  });

  it("uppdaterar befintlig användares hash", () => {
    const orig = parseHtpasswd("anna:old\n");
    const next = upsertHtpasswd(orig, "anna", "new-token");
    expect(next.get("anna")).not.toBe("old");
  });
});

describe("invites", () => {
  it("createInvite producerar ny token + 7 dygns ttl per default", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const inv = createInvite("Anna@Firma.SE ", "ADMIN", { now });
    expect(inv.email).toBe("anna@firma.se"); // normaliserat
    expect(inv.role).toBe("ADMIN");
    expect(inv.token).toBeTruthy();
    expect(inv.redeemedAt).toBeNull();
    const days = (new Date(inv.expiresAt).getTime() - now.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
  });

  it("findValidInvite returnerar ok för giltig token", () => {
    const inv = createInvite("a@b.se", "LAWYER");
    const result = findValidInvite([inv], inv.token);
    expect(result.ok).toBe(true);
  });

  it("findValidInvite avvisar utgången invite", () => {
    const past = new Date(Date.now() - 86_400_000);
    const inv = { ...createInvite("a@b.se", "LAWYER"), expiresAt: past.toISOString() };
    expect(findValidInvite([inv], inv.token).ok).toBe(false);
    expect(findValidInvite([inv], inv.token).reason).toBe("expired");
  });

  it("findValidInvite avvisar redan-inlöst", () => {
    const inv = { ...createInvite("a@b.se", "LAWYER"), redeemedAt: new Date().toISOString() };
    expect(findValidInvite([inv], inv.token).reason).toBe("already-redeemed");
  });

  it("findValidInvite avvisar okänd token", () => {
    const inv = createInvite("a@b.se", "LAWYER");
    expect(findValidInvite([inv], "no-such-token-of-correct-length-xxxxxxxxxxxxxxxxxxxxxx").reason).toBe("not-found");
  });

  it("redeemInvite markerar matchande som redeemed, lämnar andra", () => {
    const a = createInvite("a@b.se", "LAWYER");
    const b = createInvite("c@b.se", "LAWYER");
    const out = redeemInvite([a, b], a.token);
    expect(out.find((i: { token: string }) => i.token === a.token)!.redeemedAt).not.toBeNull();
    expect(out.find((i: { token: string }) => i.token === b.token)!.redeemedAt).toBeNull();
  });
});

describe("hasAdmin", () => {
  it("false när htpasswd är tom", () => {
    expect(hasAdmin(new Map())).toBe(false);
  });

  it("true när minst en användare finns", () => {
    expect(hasAdmin(parseHtpasswd("anna:h\n"))).toBe(true);
  });
});
