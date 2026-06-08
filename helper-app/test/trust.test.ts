import { describe, expect, test } from "bun:test";

import {
  addTrustedArgs,
  deleteCertArgs,
  installCaTrust,
  loginKeychain,
  removeCaTrust,
  removeTrustArgs,
  verifyCertArgs,
  type Runner,
} from "../src/tls/trust.ts";

/** Mock-runner: status per `security`-subkommando + inspelade anrop. */
function recorder(statuses: Record<string, number> = {}): { run: Runner; subcommands: () => string[] } {
  const calls: string[][] = [];
  const run: Runner = (cmd, args) => {
    calls.push([cmd, ...args]);
    return { status: statuses[args[0] ?? ""] ?? 0 };
  };
  return { run, subcommands: () => calls.map((c) => c[1] ?? "") };
}

describe("kommando-argument", () => {
  test("addTrustedArgs: betrodd rot i angiven keychain", () => {
    expect(addTrustedArgs("/p/ca.pem", "/kc.db")).toEqual([
      "add-trusted-cert", "-r", "trustRoot", "-k", "/kc.db", "/p/ca.pem",
    ]);
  });
  test("verify/remove/delete", () => {
    expect(verifyCertArgs("/p/ca.pem")).toEqual(["verify-cert", "-c", "/p/ca.pem"]);
    expect(removeTrustArgs("/p/ca.pem")).toEqual(["remove-trusted-cert", "/p/ca.pem"]);
    expect(deleteCertArgs()).toEqual(["delete-certificate", "-c", "AVA Helper Local CA", "-t"]);
  });
  test("loginKeychain-sökväg", () => {
    expect(loginKeychain("/Users/u")).toBe("/Users/u/Library/Keychains/login.keychain-db");
  });
});

describe("installCaTrust", () => {
  test("hoppas över på icke-macOS", () => {
    const rec = recorder();
    const res = installCaTrust("/p/ca.pem", { platform: "linux", run: rec.run });
    expect(res).toEqual({ ok: false, skipped: true, reason: "trust-injection stöds bara på macOS (är: linux)" });
    expect(rec.subcommands()).toHaveLength(0);
  });

  test("idempotent: redan betrott → hoppar add", () => {
    const rec = recorder({ "verify-cert": 0 });
    const res = installCaTrust("/p/ca.pem", { platform: "darwin", run: rec.run, keychain: "/kc.db" });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(true);
    expect(rec.subcommands()).toEqual(["verify-cert"]);
  });

  test("inte betrott → kör add-trusted-cert", () => {
    const rec = recorder({ "verify-cert": 1, "add-trusted-cert": 0 });
    const res = installCaTrust("/p/ca.pem", { platform: "darwin", run: rec.run, keychain: "/kc.db" });
    expect(res).toEqual({ ok: true, skipped: false });
    expect(rec.subcommands()).toEqual(["verify-cert", "add-trusted-cert"]);
  });

  test("add misslyckas → ok=false", () => {
    const rec = recorder({ "verify-cert": 1, "add-trusted-cert": 1 });
    expect(installCaTrust("/p/ca.pem", { platform: "darwin", run: rec.run }).ok).toBe(false);
  });
});

describe("removeCaTrust", () => {
  test("hoppas över på icke-macOS", () => {
    expect(removeCaTrust("/p/ca.pem", { platform: "windows", run: recorder().run }).skipped).toBe(true);
  });
  test("macOS: tar bort trust + cert", () => {
    const rec = recorder();
    const res = removeCaTrust("/p/ca.pem", { platform: "darwin", run: rec.run });
    expect(res.ok).toBe(true);
    expect(rec.subcommands()).toEqual(["remove-trusted-cert", "delete-certificate"]);
  });
});
