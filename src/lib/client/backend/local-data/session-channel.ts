/**
 * Signal mellan flikar om sessionen (#1347): en flik loggade ut. De andra
 * flikarna laddar om (och hamnar i inloggningen) i stället för att fortsätta
 * arbeta — och skriva i — den utloggades lokala databaser.
 */

import { broadcastChangeChannel, type ChangeChannel } from "@/lib/server/data-store/in-memory/change-channel";

/** Kanalens namn. */
export const SESSION_CHANNEL_NAME = "ava-session";

// ponytail: en kanal per flik räcker.
let channel: ChangeChannel | null = null;

/** Flikens sessionskanal (öppnas första gången den används). */
export function sessionChannel(): ChangeChannel {
  channel ??= broadcastChangeChannel(SESSION_CHANNEL_NAME);
  return channel;
}

/** En annan flik loggade ut → `reload` (default: ladda om sidan). Returnerar avregistreringen. */
export function onSignedOutElsewhere(reload: () => void = () => { window.location.reload(); }): () => void {
  return sessionChannel().subscribe(reload);
}
