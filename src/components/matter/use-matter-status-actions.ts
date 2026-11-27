"use client";

/**
 * Ärendets statusåtgärder (#2100): **Avsluta** (med frågan), **Återöppna** och
 * **Behåll som aktivt**. Delas av ärendehuvudet och sidan Att åtgärda, så att
 * frågan och invalideringarna är desamma på båda ställena.
 *
 * Efter varje lyckat anrop läses ärendet och Att åtgärda om, så att posten
 * "Ska ärendet markeras som avslutat?" försvinner eller kommer tillbaka.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/lib/client/trpc";

/** Det ärende som ska avslutas: id:t och titeln till frågan. */
export interface MatterToClose { id: string; title: string }

export interface MatterStatusActions {
  /** Frågar `Avsluta ärendet "<titel>"? …`; ja gör ärendet Stängt. */
  close: (matter: MatterToClose) => void;
  /** Gör ärendet Aktivt igen, utan fråga. */
  reopen: (id: string) => void;
  /** Behåll som aktivt (#2098), utan fråga. */
  keepActive: (id: string) => void;
  /** Sant medan något av anropen pågår. */
  isPending: boolean;
}

/** Frågan innan ett ärende avslutas — samma text i ärendehuvudet och i Att åtgärda. */
function closeMatterQuestion(title: string): string {
  return `Avsluta ärendet "${title}"? Det går att återöppna sen.`;
}

export function useMatterStatusActions(): MatterStatusActions {
  const t = useTRPC();
  const queryClient = useQueryClient();
  const onSuccess = async (_data: unknown, vars: { id: string }): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries(t.matter.getById.queryFilter({ id: vars.id })),
      queryClient.invalidateQueries(t.watchlist.actionItems.queryFilter()),
    ]);
  };
  const update = useMutation(t.matter.update.mutationOptions({ onSuccess }));
  const keep = useMutation(t.matter.keepActive.mutationOptions({ onSuccess }));
  return {
    close: ({ id, title }) => {
      if (!confirm(closeMatterQuestion(title))) return;
      update.mutate({ id, status: "CLOSED" });
    },
    reopen: (id) => update.mutate({ id, status: "ACTIVE" }),
    keepActive: (id) => keep.mutate({ id }),
    isPending: update.isPending || keep.isPending,
  };
}
