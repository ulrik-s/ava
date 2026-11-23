/**
 * "Nytt i AVA" (#2010) på servern: releaserna läses ur kodrepot, hålls i
 * minnet i 10 minuter, och ett fel ger det senaste svaret eller inget.
 */
import { describe, expect, it } from "vitest-compat";
import type { IReleaseNotesSource } from "@/lib/server/ports";
import {
  type FetchLike, GithubReleaseNotes, notesFromReleases, RELEASE_NOTES_TTL_MS, RELEASES_URL,
} from "@/lib/server/release-notes/github-release-notes";
import { releaseNotesRouter } from "@/lib/server/routers/release-notes";
import { asId } from "@/lib/shared/schemas/ids";

const body = (items: string[]): string => `AVA — hela paketet.\n\n## Nytt i AVA\n\n${items.map((i) => `- ${i}`).join("\n")}\n\n## What's Changed\n* fix: x`;
const RELEASES = [
  { tag_name: "v0.7.55", published_at: "2026-11-23T10:00:00Z", body: body(["Ny knapp."]), draft: false },
  { tag_name: "v0.7.54", published_at: "2026-11-22T21:40:00Z", body: "Bara teknik.", draft: false },
  { tag_name: "v0.7.56", published_at: null, body: body(["Utkast."]), draft: true },
  { tag_name: "v0.7.53", published_at: null, body: null, draft: false },
];

function fakeFetch(responses: Array<() => Response>) {
  const urls: string[] = [];
  const fetchFn: FetchLike = (url) => {
    urls.push(url);
    const next = responses.shift();
    return next ? Promise.resolve(next()) : Promise.reject(new Error("nätet nere"));
  };
  return { fetchFn, urls };
}
const ok = (json: unknown) => (): Response => new Response(JSON.stringify(json), { status: 200 });

describe("notesFromReleases", () => {
  it("bara releaser med nyheter och inga utkast", () => {
    expect(notesFromReleases(RELEASES)).toEqual([{ version: "v0.7.55", date: "2026-11-23T10:00:00Z", items: ["Ny knapp."] }]);
  });

  it("en release utan datum får tomt datum", () => {
    expect(notesFromReleases([{ tag_name: "v1.0.0", published_at: null, body: body(["A"]), draft: false }])[0]?.date).toBe("");
  });
});

describe("GithubReleaseNotes", () => {
  it("hämtar ur kodrepots releaser och återanvänder svaret i 10 minuter", async () => {
    let now = 1_000;
    const { fetchFn, urls } = fakeFetch([ok(RELEASES), ok([])]);
    const source = new GithubReleaseNotes(fetchFn, () => now);
    expect((await source.list()).map((n) => n.version)).toEqual(["v0.7.55"]);
    now += RELEASE_NOTES_TTL_MS - 1;
    await source.list();
    expect(urls).toEqual([RELEASES_URL]);
    now += 1;
    expect(await source.list()).toEqual([]);
    expect(urls).toHaveLength(2);
  });

  it("ett fel ger det senaste svaret, eller inget om inget finns", async () => {
    let now = 0;
    const { fetchFn } = fakeFetch([() => new Response("nej", { status: 503 }), ok(RELEASES)]);
    const source = new GithubReleaseNotes(fetchFn, () => now);
    expect(await source.list()).toEqual([]);
    expect(await source.list()).toHaveLength(1);
    now += RELEASE_NOTES_TTL_MS;
    expect(await source.list()).toHaveLength(1); // nätet nere → det gamla svaret
  });
});

describe("releaseNotes.list", () => {
  const USER = { id: asId<"UserId">("u-1"), email: "a@byra.se", name: "Anna", role: "LAWYER" as const, organizationId: asId<"OrganizationId">("org-1") };
  const caller = (releaseNotes?: IReleaseNotesSource) =>
    releaseNotesRouter.createCaller({ user: USER, orgId: USER.organizationId, requestId: "req-1", ports: releaseNotes ? { releaseNotes } : {} } as never);

  it("ger källans nyheter, och en tom lista utan källa", async () => {
    const note = { version: "v0.7.55", date: "2026-11-23", items: ["Ny knapp."] };
    expect(await caller({ list: () => Promise.resolve([note]) }).list()).toEqual([note]);
    expect(await caller().list()).toEqual([]);
  });
});
