/**
 * AVA Outlook task-pane — entry (#72, ADR 0013, funktion 1: spara öppet mail →
 * ärende + tidspost).
 *
 * Detta är den ENDA Office.js-värd-kopplade biten (ej CI-verifierbar — kräver
 * en Office-värd / OWA-smoke). All testbar logik bor i den injicerbara
 * `taskpane-controller` (`@/lib/client/addin/`), enhetstestad utan Outlook.
 *
 * Build: `bun run office-addin/build.ts` → taskpane.js (HTTPS-serveras).
 */

import type { AddinConfig } from "@/lib/client/addin/addin-auth";
import { startAddin, type OfficeLike } from "@/lib/client/addin/taskpane-controller";

// Office.js laddas globalt via <script> i taskpane.html, liksom config.js
// (`window.AVA_ADDIN`, skrivs per installation av office-addin/build.ts).
declare const Office: OfficeLike & { onReady(callback: () => void): void };
declare global {
  interface Window { AVA_ADDIN?: AddinConfig }
}

Office.onReady(() => { void startAddin(Office, window.AVA_ADDIN, window.location.origin); });
