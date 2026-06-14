/**
 * Tester för `registerSshKeyOnGithub` (#27 — täckning för otestad
 * säkerhetsnära klientkod). Mockar global fetch (ingen riktig request →
 * happy-dom:s same-origin-policy gäller inte). Täcker success + alla
 * fel-grenar (401/422/övrig) och detail-fallback-kedjan.
 */
import { describe, it, expect, vi, afterEach } from "vitest-compat";
import { registerSshKeyOnGithub } from "@/lib/client/github/register-ssh-key";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.clearAllMocks(); });

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const ARGS = { token: "tok-abc", title: "AVA — anna@mac", key: "ssh-ed25519 AAAA…" };

describe("registerSshKeyOnGithub", () => {
  it("POST:ar till /user/keys med Bearer-auth + JSON-body och returnerar nyckeln", async () => {
    const created = { id: 7, key: ARGS.key, title: ARGS.title, created_at: "2026-01-01", verified: true };
    const fn = mockFetch(201, created);
    const out = await registerSshKeyOnGithub(ARGS);
    expect(out).toEqual(created);
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/user/keys");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok-abc");
    expect(init.headers.Accept).toBe("application/vnd.github+json");
    expect(JSON.parse(init.body)).toEqual({ title: ARGS.title, key: ARGS.key });
  });

  it("401 → tydligt scope-fel", async () => {
    mockFetch(401, { message: "Bad credentials" });
    await expect(registerSshKeyOnGithub(ARGS)).rejects.toThrow(/401[\s\S]*admin:public_key/);
  });

  it("422 → detail ur errors[0].message", async () => {
    mockFetch(422, { message: "Validation Failed", errors: [{ message: "key is already in use" }] });
    await expect(registerSshKeyOnGithub(ARGS)).rejects.toThrow(/422.*key is already in use/);
  });

  it("annan status → 'GitHub <status>: <detail>' (message-fallback)", async () => {
    mockFetch(500, { message: "Server Error" });
    await expect(registerSshKeyOnGithub(ARGS)).rejects.toThrow(/GitHub 500: Server Error/);
  });

  it("faller till statusText när fel-bodyn inte är JSON", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("<html>oops</html>", { status: 503, statusText: "Service Unavailable" }),
    ) as unknown as typeof fetch;
    await expect(registerSshKeyOnGithub(ARGS)).rejects.toThrow(/GitHub 503: Service Unavailable/);
  });
});
