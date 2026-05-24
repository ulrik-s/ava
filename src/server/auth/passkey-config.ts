/**
 * Bygg en PasskeyConfig från env-vars.
 *
 * Default i dev: rpId=localhost, origin=http://localhost:3000.
 * I prod: PASSKEY_RP_ID + PASSKEY_ORIGIN måste sättas.
 */

import type { PasskeyConfig } from "./passkey-ceremony";

// eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Function 'getPasskeyConfig' has a complexity of 9. Maximum allowed is 8.)
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
