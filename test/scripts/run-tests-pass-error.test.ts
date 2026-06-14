/**
 * Test för `passError` (#327) — klassar ett spawnSync-resultat från ett testpass:
 * timeout (SIGKILL-hang) vs signal vs exit≠0 vs ok. Ren funktion → inga subprocesser.
 *
 * (run-tests.ts kör main() bara när det körs direkt, ej vid import — så detta
 * importerar passError utan att starta en testkörning.)
 */

import { describe, it, expect } from "vitest-compat";
import { passError } from "../../tooling/scripts/run-tests";

describe("passError", () => {
  it("ok (status 0) → null", () => {
    expect(passError("pass B", 240_000, { status: 0, signal: null })).toBeNull();
  });

  it("ETIMEDOUT → tydligt hang-meddelande med sekunder + #327", () => {
    const err = new Error("spawnSync bun ETIMEDOUT") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    const msg = passError("pass B (realgit, sekventiellt)", 240_000, { status: null, signal: "SIGKILL", error: err });
    expect(msg).toContain("översteg 240s");
    expect(msg).toContain("SIGKILL");
    expect(msg).toContain("#327");
  });

  it("exit≠0 → exit-meddelande", () => {
    expect(passError("pass A", 360_000, { status: 1, signal: null })).toBe("pass A: exit 1");
  });

  it("dödad av signal (utan error) → signal-meddelande", () => {
    expect(passError("pass A", 360_000, { status: null, signal: "SIGTERM" })).toBe("pass A: dödad av signal SIGTERM");
  });

  it("annat spawn-fel (ENOENT) → kunde-inte-köras", () => {
    const err = new Error("spawn bun ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    const msg = passError("pass A", 360_000, { status: null, signal: null, error: err });
    expect(msg).toMatch(/kunde inte köras.*ENOENT/);
  });
});
