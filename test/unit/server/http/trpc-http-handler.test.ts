/**
 * Integrationstest för tRPC-over-HTTP-handlern (#83, ADR 0013 §1).
 *
 * Driver handlern via en RIKTIG tRPC-`httpBatchLink`-klient med en injicerad
 * `fetch` → det är exakt Office-add-in:ens anropsväg (samma transport +
 * superjson-transformer). Verifierar:
 *   - Bearer-grinden: ingen/ogiltig token → 401, `openSession` aldrig anropad.
 *   - Giltig token → routern körs, principalen ur token flödar in i `ctx.user`.
 *   - `finalize` anropas efter requesten; `lock` serialiserar hela requesten.
 */
import { describe, it, expect, vi } from "vitest-compat";
import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { Context } from "@/lib/server/trpc-core";
import type { Principal } from "@/lib/server/auth/principal";
import { createTrpcHttpHandler, type RequestSession } from "@/lib/server/http/trpc-http-handler";
import { StaticPatVerifier, patRecord } from "@/lib/server/http/pat";

const PRINCIPAL: Principal = {
  id: "p-1", email: "advokat@byra.se", name: "Ada Advokat",
  role: "LAWYER", organizationId: "org-1",
};

/** Minimal Context: `users.findUniqueOrThrow` kastar → user.current faller
 *  tillbaka på ctx.user, vilket bevisar att principalen flödade in. */
function fakeContext(principal: Principal): Context {
  const dataStore = {
    users: { findUniqueOrThrow: async () => { throw new Error("no row"); } },
  };
  return { dataStore, ports: {}, user: principal } as unknown as Context;
}

interface Harness {
  handler: (req: Request) => Promise<Response>;
  openSession: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
}

function makeHarness(extra?: Partial<Parameters<typeof createTrpcHttpHandler>[0]>): Harness {
  const verifier = new StaticPatVerifier([patRecord("good-token", PRINCIPAL)]);
  const finalize = vi.fn(async () => {});
  const openSession = vi.fn((p: Principal): RequestSession => ({ context: fakeContext(p), finalize }));
  const handler = createTrpcHttpHandler({ verifier, openSession, ...extra });
  return { handler, openSession, finalize };
}

/** tRPC-klient som routar all fetch genom handlern, med valfri Bearer-token. */
function clientFor(handler: Harness["handler"], token?: string) {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({
      url: "http://ava.test/api/trpc",
      transformer: superjson,
      headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
      fetch: (input, init) => handler(new Request(input as string, init as RequestInit)),
    })],
  });
}

describe("createTrpcHttpHandler", () => {
  it("giltig Bearer → user.current returnerar principalen ur token", async () => {
    const h = makeHarness();
    const client = clientFor(h.handler, "good-token");
    const me = await client.user.current.query();
    expect(me.email).toBe(PRINCIPAL.email);
    expect(me.name).toBe(PRINCIPAL.name);
    expect(me.role).toBe(PRINCIPAL.role);
    expect(me.createdAt).toBeInstanceOf(Date); // superjson round-trippade en Date
    expect(h.openSession).toHaveBeenCalledWith(PRINCIPAL);
    expect(h.finalize).toHaveBeenCalledTimes(1); // finalize körs efter requesten
  });

  it("ingen token → 401, openSession aldrig nådd", async () => {
    const h = makeHarness();
    const client = clientFor(h.handler);
    await expect(client.user.current.query()).rejects.toBeInstanceOf(TRPCClientError);
    expect(h.openSession).not.toHaveBeenCalled();
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("ogiltig token → 401", async () => {
    const h = makeHarness();
    const client = clientFor(h.handler, "wrong-token");
    await expect(client.user.current.query()).rejects.toBeInstanceOf(TRPCClientError);
    expect(h.openSession).not.toHaveBeenCalled();
  });

  it("svarar 401 på rå request utan Authorization", async () => {
    const { handler } = makeHarness();
    const res = await handler(new Request("http://ava.test/api/trpc/user.current"));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  it("lock omsluter hela requesten (öppnas + släpps runt serveringen)", async () => {
    const events: string[] = [];
    const lock = async <T>(fn: () => Promise<T>): Promise<T> => {
      events.push("lock:acquire");
      try { return await fn(); } finally { events.push("lock:release"); }
    };
    const h = makeHarness({ lock });
    h.finalize.mockImplementation(async () => { events.push("finalize"); });
    const client = clientFor(h.handler, "good-token");
    await client.user.current.query();
    // finalize sker inuti låset (före release).
    expect(events).toEqual(["lock:acquire", "finalize", "lock:release"]);
  });

  it("finalize körs även när requesten är ett 401 (gör den inte) — dvs bara vid auth", async () => {
    const h = makeHarness();
    await h.handler(new Request("http://ava.test/api/trpc/user.current")); // ingen auth
    expect(h.finalize).not.toHaveBeenCalled();
  });

  it("rapporterar router-fel via onError-hooken (okänd procedure)", async () => {
    const verifier = new StaticPatVerifier([patRecord("good-token", PRINCIPAL)]);
    const onError = vi.fn();
    const finalize = vi.fn(async () => {});
    const handler = createTrpcHttpHandler({
      verifier,
      openSession: (p) => ({ context: fakeContext(p), finalize }),
      onError,
    });
    const res = await handler(new Request(
      "http://ava.test/api/trpc/does.not.exist?input=%7B%7D",
      { headers: { authorization: "Bearer good-token" } },
    ));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(onError).toHaveBeenCalled();
    expect(finalize).toHaveBeenCalled(); // finalize körs i finally även vid fel
  });
});
