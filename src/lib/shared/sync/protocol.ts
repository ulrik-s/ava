/**
 * Synkprotokollets version (#1772): servern säger i varje pull vilken version
 * av synken den talar och vilken som är den äldsta klient den förstår. Passar
 * de inte ihop — servern är äldre (en rollback), eller klienten är för gammal
 * — skickar klienten inga ändringar: de ligger kvar i kön tills versionerna
 * passar, och användaren får veta varför.
 *
 * Höj `SYNC_PROTOCOL_VERSION` när synkens trådformat ändras så att en äldre
 * motpart inte förstår det, och `MIN_CLIENT_PROTOCOL` när servern slutar
 * förstå äldre klienter. Releaseetiketten följer bara med som information:
 * taggar och sha:er går inte att ordna säkert, så den jämförs aldrig.
 */

/** Den synk den här koden talar. */
export const SYNC_PROTOCOL_VERSION = 1;

/** Den äldsta klient servern förstår. */
export const MIN_CLIENT_PROTOCOL = 1;

/** Det servern säger om sig själv i pullen. */
export interface ServerSyncInfo {
  protocol: number;
  minClient: number;
  /** Serverns release (`AVA_RELEASE`), om den är känd — bara information. */
  release: string | null;
}

/** Serverns del av handskakningen. */
export const serverSyncInfo = (release: string | undefined): ServerSyncInfo =>
  ({ protocol: SYNC_PROTOCOL_VERSION, minClient: MIN_CLIENT_PROTOCOL, release: release ?? null });

/** En server från före handskakningen skickar inget: den talar version 1. */
const LEGACY_SERVER: Pick<ServerSyncInfo, "protocol" | "minClient"> = { protocol: 1, minClient: 1 };

/** Hur klientens och serverns versioner förhåller sig. */
export type SyncCompatibility = "ok" | "server-older" | "client-older";

/** Passar klientens protokoll (`client`) med serverns? */
export function syncCompatibility(server: ServerSyncInfo | undefined, client: number = SYNC_PROTOCOL_VERSION): SyncCompatibility {
  const s = server ?? LEGACY_SERVER;
  if (s.protocol < client) return "server-older";
  return client < s.minClient ? "client-older" : "ok";
}

/** Beskedet till användaren; ändringarna ligger kvar i kön. */
const MESSAGES: Readonly<Record<Exclude<SyncCompatibility, "ok">, string>> = {
  "server-older": "Servern kör en äldre version av AVA än den här sidan. Dina ändringar sparas här och skickas när servern är uppdaterad.",
  "client-older": "Den här versionen av AVA är för gammal för servern. Ladda om sidan för att få den nya; dina ändringar sparas här så länge.",
};

/** Beskedet när versionerna inte passar, eller null när de gör det. */
export function incompatibleMessage(server: ServerSyncInfo | undefined, client: number = SYNC_PROTOCOL_VERSION): string | null {
  const c = syncCompatibility(server, client);
  return c === "ok" ? null : MESSAGES[c];
}
