/**
 * Enhetstester för Bearer-PAT-autentiseringen (#83, ADR 0013 §3).
 * Täcker token-parsning, hashning, konstant-tid-verifiering och
 * defensiv hantering av okända/trasiga tokens.
 */
import { describe, it, expect } from "vitest-compat";
import {
  sha256Hex, parseBearerToken, StaticPatVerifier, patRecord, type PatRecord,
} from "@/lib/server/http/pat";
import type { Principal } from "@/lib/server/auth/principal";

const PRINCIPAL: Principal = {
  id: "p-1", email: "advokat@byra.se", name: "Ada Advokat",
  role: "LAWYER", organizationId: "org-1",
};

describe("sha256Hex", () => {
  it("ger deterministisk 64-tecken hex-hash", () => {
    const h = sha256Hex("hemlig-token");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("hemlig-token")).toBe(h);
  });
  it("olika input → olika hash", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("parseBearerToken", () => {
  it("plockar ut token ur 'Bearer <token>'", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });
  it("är skiftlägesokänsligt för schemat och trimmar token", () => {
    expect(parseBearerToken("bearer   abc123  ")).toBe("abc123");
    expect(parseBearerToken("  Bearer\tabc123")).toBe("abc123");
  });
  it("returnerar null för saknad/tom/annan auth", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken("")).toBeNull();
    expect(parseBearerToken("Basic dXNlcjpwYXNz")).toBeNull();
  });
  it("returnerar null när Bearer saknar token", () => {
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken("Bearer    ")).toBeNull();
  });
});

describe("StaticPatVerifier", () => {
  const verifier = new StaticPatVerifier([patRecord("good-token", PRINCIPAL)]);

  it("verifierar känd token → principal", () => {
    expect(verifier.verify("good-token")).toEqual(PRINCIPAL);
  });
  it("okänd token → null", () => {
    expect(verifier.verify("wrong-token")).toBeNull();
  });
  it("tom token → null", () => {
    expect(verifier.verify("")).toBeNull();
  });
  it("väljer rätt principal bland flera poster", () => {
    const other: Principal = { ...PRINCIPAL, id: "p-2", email: "b@b.se" };
    const multi = new StaticPatVerifier([
      patRecord("token-a", PRINCIPAL),
      patRecord("token-b", other),
    ]);
    expect(multi.verify("token-b")).toEqual(other);
    expect(multi.verify("token-a")).toEqual(PRINCIPAL);
  });
  it("trasig tokenHash (fel längd) → null utan att kasta", () => {
    const bad: PatRecord = { tokenHash: "deadbeef", principal: PRINCIPAL };
    const v = new StaticPatVerifier([bad]);
    expect(v.verify("good-token")).toBeNull();
  });
});

describe("patRecord", () => {
  it("hashar token till tokenHash (aldrig klartext)", () => {
    const rec = patRecord("min-token", PRINCIPAL);
    expect(rec.tokenHash).toBe(sha256Hex("min-token"));
    expect(rec.tokenHash).not.toContain("min-token");
    expect(rec.principal).toEqual(PRINCIPAL);
  });
});
