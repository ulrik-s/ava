"use client";

/**
 * Ärendets alla dokument, i alla mappar (#1308).
 *
 * `document.list` ger bara EN mapp (`folderId: null` = rotmappen). Sedan #985
 * filas kostnadsräkningar i `/Domstol/Kostnadsräkningar`, så de som letade efter
 * KR-dokumentet i rotmappen hittade det inte. `document.tree` ger alla dokument
 * i ärendet, och trädvyn hämtar samma query (react-query dedupar).
 */

import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Ett dokument i ärendet, som `document.tree` returnerar det. */
export type MatterDocument = inferRouterOutputs<AppRouter>["document"]["tree"]["documents"][number];

/** Alla dokument i ärendet; `undefined` tills de laddats. */
export function useMatterDocuments(matterId: MatterId): readonly MatterDocument[] | undefined {
  return trpc.document.tree.useQuery({ matterId }).data?.documents;
}
