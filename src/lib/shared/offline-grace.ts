/**
 * Offline-grace (ADR 0018): hur länge en klient får arbeta under den cachade
 * identiteten utan att sessionen kunnat verifieras online. Delas av serverns
 * `CachedSessionAuthProvider` och klientens sessionsgrind (#1245).
 */

/** ~7 dagar — ADR 0018 default-grace. */
export const DEFAULT_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
