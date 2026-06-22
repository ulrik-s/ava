/**
 * InMemoryLeaseStore (ADR 0033 §2) — mjuk lease med heartbeat/stale/expire.
 * Injicerad klocka → deterministiska trösklar.
 */

import { describe, it, expect } from "vitest-compat";
import { InMemoryLeaseStore, LEASE_EXPIRE_MS, LEASE_STALE_MS } from "@/lib/server/lease/lease-store";

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe("InMemoryLeaseStore.acquire", () => {
  it("tar en fri lease → acquired, hållare satt", () => {
    const store = new InMemoryLeaseStore(clock().now);
    const res = store.acquire("d1", "u1", "Anna");
    expect(res.acquired).toBe(true);
    expect(res.lease).toMatchObject({ documentId: "d1", holderId: "u1", holderName: "Anna", stale: false });
  });

  it("leasad av annan (levande) → acquired:false + den andras lease", () => {
    const store = new InMemoryLeaseStore(clock().now);
    store.acquire("d1", "u1", "Anna");
    const res = store.acquire("d1", "u2", "Bo");
    expect(res.acquired).toBe(false);
    expect(res.lease.holderId).toBe("u1");
    expect(res.lease.holderName).toBe("Anna");
  });

  it("själv-återtagande: egen lease → acquired, behåller acquiredAt", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    const first = store.acquire("d1", "u1", "Anna");
    c.advance(60_000);
    const again = store.acquire("d1", "u1", "Anna");
    expect(again.acquired).toBe(true);
    expect(again.lease.acquiredAt).toBe(first.lease.acquiredAt); // samma session
    expect(again.lease.lastHeartbeatAt).toBeGreaterThan(first.lease.lastHeartbeatAt);
  });

  it("utgången lease (annans) → fri att ta", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    store.acquire("d1", "u1", "Anna");
    c.advance(LEASE_EXPIRE_MS);
    const res = store.acquire("d1", "u2", "Bo");
    expect(res.acquired).toBe(true);
    expect(res.lease.holderId).toBe("u2");
  });
});

describe("InMemoryLeaseStore stale/expire-trösklar", () => {
  it("stale efter STALE_MS men före EXPIRE_MS (fortf. hållen)", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    store.acquire("d1", "u1", "Anna");
    c.advance(LEASE_STALE_MS);
    const lease = store.get("d1");
    expect(lease).not.toBeNull();
    expect(lease!.stale).toBe(true); // erbjuder ta-över
  });

  it("get efter EXPIRE_MS → null (fritt)", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    store.acquire("d1", "u1", "Anna");
    c.advance(LEASE_EXPIRE_MS);
    expect(store.get("d1")).toBeNull();
  });
});

describe("InMemoryLeaseStore.renew", () => {
  it("hållaren förnyar → true, nollställer stale", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    store.acquire("d1", "u1", "Anna");
    c.advance(LEASE_STALE_MS);
    expect(store.renew("d1", "u1")).toBe(true);
    expect(store.get("d1")!.stale).toBe(false); // heartbeat → färsk igen
  });

  it("icke-hållare förnyar → false", () => {
    const store = new InMemoryLeaseStore(clock().now);
    store.acquire("d1", "u1", "Anna");
    expect(store.renew("d1", "u2")).toBe(false);
  });

  it("utgången lease förnyas inte → false", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    store.acquire("d1", "u1", "Anna");
    c.advance(LEASE_EXPIRE_MS);
    expect(store.renew("d1", "u1")).toBe(false);
  });
});

describe("InMemoryLeaseStore.release / takeover", () => {
  it("hållaren släpper → fritt; icke-hållare kan inte släppa", () => {
    const store = new InMemoryLeaseStore(clock().now);
    store.acquire("d1", "u1", "Anna");
    store.release("d1", "u2"); // fel hållare → no-op
    expect(store.get("d1")).not.toBeNull();
    store.release("d1", "u1");
    expect(store.get("d1")).toBeNull();
  });

  it("takeover tar över ett levande lås permanent (annan användare)", () => {
    const c = clock();
    const store = new InMemoryLeaseStore(c.now);
    store.acquire("d1", "u1", "Anna");
    c.advance(LEASE_STALE_MS); // stale men ej utgången
    const taken = store.takeover("d1", "u2", "Bo");
    expect(taken.holderId).toBe("u2");
    expect(taken.stale).toBe(false);
    // u1 har förlorat den → renew misslyckas.
    expect(store.renew("d1", "u1")).toBe(false);
  });
});
