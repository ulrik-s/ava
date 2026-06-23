/**
 * `saveIncomingMail` — orkestrerar Outlook-add-in:ens funktion 1 (#72, ADR 0013):
 * hämta det öppna mailets `.eml` via MS Graph och spara det i valt ärende +
 * (valfri) tidspost via AVA-serverns tRPC-API.
 *
 * Office.js-fritt med flit: Office-glue:n (konvertera `itemId` → REST-id via
 * `convertToRestId`, hämta callback-/Graph-token, läsa ämne/datum ur `item`)
 * lever i den tunna task-pane-shell:en (office-addin/, ej CI-verifierbar).
 * Här ligger den *testbara* affärslogiken: alla beroenden injiceras.
 */

import type { inferRouterInputs } from "@trpc/server";
import { fetchMessageEml, type GraphFetch } from "@/lib/client/graph/graph-mail";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { MatterId } from "@/lib/shared/schemas/ids";

type SaveIncomingInput = inferRouterInputs<AppRouter>["mail"]["saveIncoming"];

/** Den minimala add-in-klient-ytan funktionen behöver (uppfylls av
 *  `createAddinClient(...)`s `TRPCClient<AppRouter>`). */
export interface MailSaverClient {
  mail: { saveIncoming: { mutate: (input: SaveIncomingInput) => Promise<unknown> } };
}

export interface SaveIncomingMailDeps {
  /** AVA-server-klient (Bearer-PAT) — typ. `createAddinClient(...)`. */
  client: MailSaverClient;
  /** MS Graph-token (Office-sidans data, ortogonal mot PAT). */
  graphToken: string;
  /** Meddelandets REST-id (konverterat från Office `itemId` av shell:en). */
  restId: string;
  /** Valt ärende. */
  matterId: MatterId;
  /** Mejlets ämne (ur Office `item.subject`). */
  subject: string;
  /** Mottaget-datum, ISO (ur Office `item.dateTimeCreated`). */
  receivedAt: string;
  /** Valfri tidspost att bokföra i samma operation. */
  time?: { minutes: number; description?: string };
  /** Valfri folder i ärendet. */
  folderId?: string | null;
  /** MIME-bas-URL (default Graph; add-in:en kan ange mailbox-REST-URL:en). */
  mimeBaseUrl?: string;
  /** Valfri Graph-`fetch`-override (test). */
  fetch?: GraphFetch;
}

/**
 * Hämta `.eml` via Graph → POST till AVA (`mail.saveIncoming`). Returnerar
 * mutationens svar (dokument + ev. tidspost). Kastar om Graph- eller
 * AVA-anropet misslyckas (shell:en visar felet i panelen).
 */
export async function saveIncomingMail(deps: SaveIncomingMailDeps): Promise<unknown> {
  const { base64 } = await fetchMessageEml({
    token: deps.graphToken,
    restId: deps.restId,
    ...(deps.mimeBaseUrl ? { baseUrl: deps.mimeBaseUrl } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  return deps.client.mail.saveIncoming.mutate({
    matterId: deps.matterId,
    emlBase64: base64,
    subject: deps.subject,
    receivedAt: deps.receivedAt,
    ...(deps.folderId !== undefined ? { folderId: deps.folderId } : {}),
    ...(deps.time ? { time: deps.time } : {}),
  });
}
