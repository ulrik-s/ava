/**
 * Bygg en PasskeyConfig från env-vars.
 *
 * Default i dev: rpId=localhost, origin=http://localhost:3000.
 * I prod: PASSKEY_RP_ID + PASSKEY_ORIGIN måste sättas.
 */

import type { PasskeyConfig } from "./passkey-ceremony";

export function getPasskeyConfig(): PasskeyConfig {
  const isDev = process.env.NODE_ENV !== "production";
  const rpId = process.env.PASSKEY_RP_ID ?? (isDev ? "localhost" : "");
  const origin = process.env.PASSKEY_ORIGIN
    ?? process.env.NEXTAUTH_URL
    ?? (isDev ? "http://localhost:3000" : "");
  if (!rpId || !origin) {
    throw new Error(
      "PASSKEY_RP_ID och PASSKEY_ORIGIN måste vara satt (eller NEXTAUTH_URL för origin).",
    );
  }
  return {
    rpName: process.env.PASSKEY_RP_NAME ?? "AVA",
    rpId,
    origin,
  };
}
