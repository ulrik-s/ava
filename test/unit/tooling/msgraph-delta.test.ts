import { describe, it, expect } from "vitest-compat";
import { assertMessageDelta, snapshotMessageIds, PAGE_SIZE } from "../../../tooling/scripts/msgraph-delta";

/**
 * Delta-kollen (#1075) är det enda som kan se att det landade något MER än
 * testet skapade. Går pagineringen sönder rapporterar den "inget nytt" i
 * stället för att fälla — en tyst delta-koll är värre än ingen alls, så det
 * är pagineringen som testas hårdast här.
 */
function pagedFetch(pages: ReadonlyArray<{ ids: string[]; next?: string }>) {
  const seen: string[] = [];
  const fn = (async (url: string | URL) => {
    seen.push(String(url));
    const page = pages[seen.length - 1];
    if (!page) return new Response("slut", { status: 500 });
    return new Response(JSON.stringify({
      value: page.ids.map((id) => ({ id })),
      ...(page.next ? { "@odata.nextLink": page.next } : {}),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as (input: string | URL, init?: RequestInit) => Promise<Response>;
  return { fn, seen };
}

describe("snapshotMessageIds", () => {
  it("samlar id:n från en enda sida", async () => {
    const { fn } = pagedFetch([{ ids: ["a", "b"] }]);
    expect([...await snapshotMessageIds(fn, "t", "/start")]).toEqual(["a", "b"]);
  });

  // Utan nextLink-loopen tystnar listningen vid sidbrytningen.
  it("följer @odata.nextLink över flera sidor", async () => {
    const { fn } = pagedFetch([
      { ids: ["a"], next: "/s2" },
      { ids: ["b"], next: "/s3" },
      { ids: ["c"] },
    ]);
    expect([...await snapshotMessageIds(fn, "t", "/s1")].sort()).toEqual(["a", "b", "c"]);
  });

  /**
   * `nextLink` bär en skip-token och ska följas ORDAGRANT. Byggs URL:en om av
   * oss börjar listningen om från sida ett — en oändlig loop som ser ut som
   * en hängning, inte som ett fel.
   */
  it("följer nextLink ordagrant, bygger inte om URL:en", async () => {
    const { fn, seen } = pagedFetch([{ ids: ["a"], next: "https://graph.test/x?$skiptoken=ABC" }, { ids: ["b"] }]);
    await snapshotMessageIds(fn, "t", "/start");
    expect(seen[1]).toBe("https://graph.test/x?$skiptoken=ABC");
  });

  it("dedupliserar id:n som återkommer mellan sidor", async () => {
    const { fn } = pagedFetch([{ ids: ["a", "b"], next: "/s2" }, { ids: ["b", "c"] }]);
    expect((await snapshotMessageIds(fn, "t", "/s1")).size).toBe(3);
  });

  it("tål en sida utan value", async () => {
    const fn = (async () => new Response("{}", { status: 200 })) as never;
    expect((await snapshotMessageIds(fn, "t", "/start")).size).toBe(0);
  });

  it("kastar med Graphs felkropp vid icke-2xx", async () => {
    const fn = (async () => new Response('{"error":{"code":"InvalidFilter"}}', { status: 400 })) as never;
    await expect(snapshotMessageIds(fn, "t", "/start")).rejects.toThrow(/InvalidFilter/);
  });

  // Sidstorleken måste vara liten nog att loopen körs varje gång — annars är
  // pagineringskoden otestad i praktiken tills brevlådan vuxit i månader.
  it("har en sidstorlek som tvingar fram paginering", () => {
    expect(PAGE_SIZE).toBeLessThanOrEqual(5);
  });
});

describe("assertMessageDelta", () => {
  const before = new Set(["gammal-1", "gammal-2"]);

  it("accepterar exakt det testet skapade", () => {
    expect(() => assertMessageDelta(before, new Set([...before, "ny"]), ["ny"])).not.toThrow();
  });

  // Poängen med hela kollen: en dubblett som read-back aldrig kan se.
  it("fäller på ett meddelande testet inte skapade", () => {
    expect(() => assertMessageDelta(before, new Set([...before, "ny", "främling"]), ["ny"]))
      .toThrow(/inte skapade/);
  });

  it("fäller när det förväntade meddelandet saknas", () => {
    expect(() => assertMessageDelta(before, new Set([...before]), ["ny"])).toThrow(/saknas/);
  });

  // Gammalt skräp i både före och efter tar ut sig självt — det är därför
  // brevlådan aldrig behöver tömmas.
  it("bryr sig inte om ackumulerad historik", () => {
    const stort = new Set(Array.from({ length: 500 }, (_, i) => `g-${i}`));
    expect(() => assertMessageDelta(stort, new Set([...stort, "ny"]), ["ny"])).not.toThrow();
  });
});
