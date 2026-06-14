/**
 * Enhetstester för `buildServerApiHandler` (#83 steg 1c) — composition-root:en.
 * Verifierar token-grinden (utan git): inget API utan tokens, och att en
 * konfigurerad token krävs (401 utan/fel token, session/git aldrig nådd).
 */
import { describe, it, expect } from "vitest-compat";
import type { Principal } from "@/lib/server/auth/principal";
import { buildServerApiHandler, type ServerApiConfig } from "@/lib/server/http/server-api";

const PRINCIPAL: Principal = {
  id: "sr", email: "sr@ava.local", name: "SR", role: "ADMIN", organizationId: "org-1",
};

const baseConfig = (tokens: string[]): ServerApiConfig => ({
  workDir: "/nonexistent/wc", remote: "origin", branch: "main",
  apiTokens: tokens, principal: PRINCIPAL,
});

const noLock = <T>(fn: () => Promise<T>) => fn();

describe("buildServerApiHandler", () => {
  it("inga tokens → null (inget API monteras)", () => {
    expect(buildServerApiHandler(baseConfig([]), { lock: noLock })).toBeNull();
  });

  it("med tokens → handler; saknad token → 401 (working-copy aldrig öppnad)", async () => {
    const handler = buildServerApiHandler(baseConfig(["good"]), { lock: noLock });
    expect(handler).not.toBeNull();
    const res = await handler!(new Request("http://x/api/trpc/user.current"));
    expect(res.status).toBe(401);
    // Att vi får 401 (inte ett git-/ENOENT-fel mot /nonexistent/wc) bevisar att
    // auth-grinden går FÖRE openSession → ingen working-copy-hydrering skedde.
  });

  it("fel token → 401", async () => {
    const handler = buildServerApiHandler(baseConfig(["good"]), { lock: noLock });
    const res = await handler!(new Request("http://x/api/trpc/user.current", {
      headers: { authorization: "Bearer wrong" },
    }));
    expect(res.status).toBe(401);
  });
});
