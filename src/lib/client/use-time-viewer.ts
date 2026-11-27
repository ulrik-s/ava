"use client";

/**
 * Vem som tittar på Tidregistrering (#2114): den inloggades id och om rollen
 * ser allas tider (`seesAllTime`). Rollen läses ur användarraden
 * (`user.current`); tills den har svarat är tittaren okänd, så att listan
 * inte frågar efter någon annans poster ens kortvarigt.
 */

import { trpc } from "@/lib/client/trpc";
import { seesAllTime } from "@/lib/shared/report-subject";
import { userRoleSchema } from "@/lib/shared/schemas/enums";
import { asId, type UserId } from "@/lib/shared/schemas/ids";

/** Tittaren: okänd medan `user.current` laddar, sedan känd. */
export type TimeViewer =
  | { status: "loading" }
  | { status: "ready"; selfId: UserId; seesAll: boolean };

/** Användarraden så som {@link timeViewerOf} läser den. */
interface CurrentUser { id: string; role: string }

/**
 * Tittaren ur `user.current`-svaret. En okänd roll räknas inte som Admin
 * (fail-safe: personen ser bara sina egna tider).
 */
export function timeViewerOf(me: CurrentUser | undefined): TimeViewer {
  if (!me?.id) return { status: "loading" };
  const role = userRoleSchema.safeParse(me.role);
  return { status: "ready", selfId: asId<"UserId">(me.id), seesAll: role.success && seesAllTime(role.data) };
}

/** Den inloggade tittaren på Tidregistrering. */
export function useTimeViewer(): TimeViewer {
  const me = trpc.user.current.useQuery();
  return timeViewerOf(me.data);
}
