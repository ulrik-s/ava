"use client";

/**
 * Dispatcher för mirror-to-outlook-workern.
 *
 * Workern (utanför React-trädet) behöver:
 *   1. Hämta access-token (från O365-connectorn, eller från localStorage-
 *      fallback om användaren manuellt klistrat in en token)
 *   2. Uppdatera CalendarEvent-rader med mirror-status efter sync
 *
 * Båda går genom registrerade dispatcher-callbacks (samma pattern som
 * analyze-dispatch och extract-text-dispatch).
 */

export interface UpdateMirrorStateArgs {
  eventId: string;
  patch: {
    outlookEventId?: string | null;
    mirrorStatus: "synced" | "failed" | "pending" | null;
    mirrorError?: string | null;
    mirrorLastSyncedAt?: Date | null;
  };
  signal?: AbortSignal;
}

export type TokenProvider = () => Promise<string | null>;
export type UpdateMirrorState = (args: UpdateMirrorStateArgs) => Promise<void>;

let tokenProvider: TokenProvider | null = null;
let updateMirrorState: UpdateMirrorState | null = null;

export function setOutlookTokenProvider(fn: TokenProvider | null): void {
  tokenProvider = fn;
}

export function setMirrorStateDispatcher(fn: UpdateMirrorState | null): void {
  updateMirrorState = fn;
}

export async function getOutlookToken(): Promise<string | null> {
  if (!tokenProvider) return null;
  try {
    return await tokenProvider();
  } catch { return null; }
}

export async function dispatchMirrorState(args: UpdateMirrorStateArgs): Promise<void> {
  if (!updateMirrorState) {
    throw new Error("Ingen mirror-state-dispatcher registrerad");
  }
  if (args.signal?.aborted) throw new Error("Aborted");
  await updateMirrorState(args);
}
