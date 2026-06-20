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

import { bootstrap, type OfficeLike } from "@/lib/client/addin/taskpane-controller";

// Office.js laddas globalt via <script> i taskpane.html. `OfficeLike` täcker
// det subset vi rör; `onReady` läggs på för entry-punkten.
declare const Office: OfficeLike & { onReady(callback: () => void): void };

Office.onReady(() => bootstrap(Office));
