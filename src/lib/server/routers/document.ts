/**
 * Document-routern — komposition av fyra separerade procedurmoduler.
 *
 * Det externa API:t är medvetet platt (`trpc.document.createFolder`,
 * `trpc.document.acceptSuggestionGroup`, …) så att befintliga komponenter
 * och tester fortsätter fungera. Själva implementationen är uppdelad efter
 * ansvarsområde i `./document/`:
 *
 *   • core         — dokument-CRUD, tree, search, AI-analys
 *   • folders      — mappar, flytt, breadcrumb
 *   • suggestions  — AI-kontaktförslag (accept/reject, grupp-accept, dedup)
 *   • events       — AI-extraherade kalenderhändelser
 */

import { router } from "../trpc";
import { coreProcedures } from "./document/core";
import { eventProcedures } from "./document/events";
import { folderProcedures } from "./document/folders";
import { suggestionProcedures } from "./document/suggestions";

export const documentRouter = router({
  ...coreProcedures,
  ...folderProcedures,
  ...suggestionProcedures,
  ...eventProcedures,
});
