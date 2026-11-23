"use client";

/**
 * "Nytt i AVA" (#2010): nyheterna läses PÅ SERVERN (ur kodrepots releaser)
 * och hämtas bara när servern annonserar `releaseNotes`. Vilken version
 * användaren senast såg sparas per enhet i localStorage.
 */

import { useQuery } from "@tanstack/react-query";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import type { ReleaseNote } from "@/lib/shared/release-notes";
import { serverTrpcClient as server } from "./server-trpc-client";

/** Senast sedda versionen (per enhet; inget känsligt, så den rensas inte vid utloggning). */
export const RELEASE_NOTES_SEEN_KEY = "ava.releaseNotesSeen";

/** Nyheterna i de senaste versionerna, nyast först (tom utan server). */
export function useReleaseNotes() {
  const enabled = useCapabilities().releaseNotes;
  return useQuery({
    queryKey: ["server", "releaseNotes.list"],
    queryFn: (): Promise<ReleaseNote[]> => server().releaseNotes.list.query(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** Senast sedda versionen, eller null (aldrig sett, eller ingen lagring). */
export function readSeenRelease(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return storage.getItem(RELEASE_NOTES_SEEN_KEY);
  } catch {
    return null;
  }
}

/** Kom ihåg att användaren sett nyheterna fram till `version`. */
export function writeSeenRelease(version: string, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(RELEASE_NOTES_SEEN_KEY, version);
  } catch {
    // ponytail: utan lagring visas nyheterna igen nästa gång — hellre det än ett fel.
  }
}
