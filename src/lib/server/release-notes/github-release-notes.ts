/**
 * "Nytt i AVA" (#2010) ur ava:s publika GitHub-releaser: rubriken
 * `## Nytt i AVA` i varje release. Repot är publikt, så ingen token behövs.
 * Svaret hålls i minnet en stund, och ett fel ger det senaste svaret (eller
 * inget): nyheterna får aldrig stoppa appen.
 */
import { z } from "zod";
import type { IReleaseNotesSource } from "@/lib/server/ports";
import { extractUserNotes, type ReleaseNote } from "@/lib/shared/release-notes";

/** De senaste releaserna i kodrepot. */
export const RELEASES_URL = "https://api.github.com/repos/ulrik-s/ava/releases?per_page=20";
/** Så länge ett svar från GitHub återanvänds. */
export const RELEASE_NOTES_TTL_MS = 10 * 60_000;

const releasesSchema = z.array(z.object({
  tag_name: z.string(),
  published_at: z.string().nullable(),
  body: z.string().nullable(),
  draft: z.boolean(),
}));

/** Det enda av `fetch` källan använder — lätt att ersätta i tester. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Releasernas nyheter, nyast först; releaser utan nyheter (eller utkast) hoppas över. */
export function notesFromReleases(json: unknown): ReleaseNote[] {
  return releasesSchema.parse(json).flatMap((r) => {
    const items = r.draft ? [] : extractUserNotes(r.body ?? "");
    return items.length === 0 ? [] : [{ version: r.tag_name, date: r.published_at ?? "", items }];
  });
}

export class GithubReleaseNotes implements IReleaseNotesSource {
  private cached: { at: number; notes: ReleaseNote[] } | null = null;

  constructor(private readonly fetchFn: FetchLike = fetch, private readonly now: () => number = Date.now) {}

  async list(): Promise<ReleaseNote[]> {
    if (this.cached && this.now() - this.cached.at < RELEASE_NOTES_TTL_MS) return this.cached.notes;
    try {
      const res = await this.fetchFn(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      this.cached = { at: this.now(), notes: notesFromReleases(await res.json()) };
    } catch {
      // ponytail: ett fel försöker igen vid nästa anrop; inget backoff — anropen är få (en per inloggad flik och 10 min).
      return this.cached?.notes ?? [];
    }
    return this.cached.notes;
  }
}
