/**
 * Tester för `loadDemoSeed` — direkt GH-Pages-seed-loadern (#420, ADR 0016).
 *
 * Verifierar: manifest-fetch, gruppering per entitet, prebakeJoins-joins,
 * 404-tolerans, all-404-fel, tomt-manifest-fel, och version-grinden.
 */

import { describe, it, expect } from "vitest-compat";
import { loadDemoSeed } from "@/lib/client/demo/demo-seed-loader";

const noSleep = () => Promise.resolve();

const BASE = "https://demo.example.io/r";

/** Bygg en fake-fetch som svarar med given body per (relativ) path. */
function fakeFetch(files: Record<string, { status?: number; body?: string }>): typeof fetch {
  return (async (url: string) => {
    const path = url.replace(`${BASE}/`, "");
    const hit = files[path];
    if (!hit || hit.status === 404) {
      return new Response(hit?.body ?? "not found", { status: 404 });
    }
    return new Response(hit.body ?? "", { status: hit.status ?? 200 });
  }) as unknown as typeof fetch;
}

const baseOpts = { baseUrl: BASE, sleepFn: noSleep, maxRetries: 1 };

describe("loadDemoSeed", () => {
  it("fetchar manifest + grupperar filer per entitet och prebaka:r joins", async () => {
    const matter = { id: "m1", matterNumber: "2026-1", title: "T", status: "ACTIVE", organizationId: "o" };
    const contact = { id: "c1", name: "K", contactType: "PERSON", organizationId: "o" };
    const mc = { id: "mc1", matterId: "m1", contactId: "c1" };
    const files = {
      "manifest.json": { body: JSON.stringify({ paths: ["matters/active/m1.json", "contacts/c1.json", "matter-contacts/mc1.json"] }) },
      "matters/active/m1.json": { body: JSON.stringify(matter) },
      "contacts/c1.json": { body: JSON.stringify(contact) },
      "matter-contacts/mc1.json": { body: JSON.stringify(mc) },
    };

    const source = await loadDemoSeed("x/r", { ...baseOpts, fetchFn: fakeFetch(files) });

    expect(source.matters).toHaveLength(1);
    expect(source.contacts).toHaveLength(1);
    expect(source.matterContacts).toHaveLength(1);
    // prebakeJoins fyllde nästlade contact/matter på matterContact.
    const joined = source.matterContacts![0] as { contact: unknown; matter: unknown };
    expect((joined.contact as { id: string }).id).toBe("c1");
    expect((joined.matter as { id: string }).id).toBe("m1");
  });

  it("tolererar enstaka 404 men laddar resten", async () => {
    const files = {
      "manifest.json": { body: JSON.stringify({ paths: ["matters/active/m1.json", ".ava/users/missing.json"] }) },
      "matters/active/m1.json": { body: JSON.stringify({ id: "m1", matterNumber: "1", title: "T", status: "ACTIVE", organizationId: "o" }) },
      // missing.json saknas → 404
    };
    const source = await loadDemoSeed("x/r", { ...baseOpts, fetchFn: fakeFetch(files) });
    expect(source.matters).toHaveLength(1);
    expect(source.users ?? []).toHaveLength(0);
  });

  it("kastar om ALLA paths 404:ar", async () => {
    const files = { "manifest.json": { body: JSON.stringify({ paths: ["matters/active/x.json"] }) } };
    await expect(loadDemoSeed("x/r", { ...baseOpts, fetchFn: fakeFetch(files) }))
      .rejects.toThrow(/Kunde inte hämta NÅGON fil/);
  });

  it("kastar vid tomt/ogiltigt manifest", async () => {
    const files = { "manifest.json": { body: JSON.stringify({ paths: [] }) } };
    await expect(loadDemoSeed("x/r", { ...baseOpts, fetchFn: fakeFetch(files) }))
      .rejects.toThrow(/tomt eller ogiltigt/);
  });

  it("kastar via versionsgrinden om repo:t är nyare än koden", async () => {
    const files = {
      "manifest.json": { body: JSON.stringify({ paths: ["matters/active/m1.json", ".ava/meta.json"] }) },
      "matters/active/m1.json": { body: JSON.stringify({ id: "m1", matterNumber: "1", title: "T", status: "ACTIVE", organizationId: "o" }) },
      ".ava/meta.json": { body: JSON.stringify({ schemaVersion: 999 }) },
    };
    await expect(loadDemoSeed("x/r", { ...baseOpts, fetchFn: fakeFetch(files) }))
      .rejects.toThrow();
  });
});
