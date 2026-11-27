/**
 * Uppstartsfyllningar (#2177) — datafyllningar som server-first kör en gång
 * efter varje start, i bakgrunden.
 *
 * Förebild: `JOB_SCHEDULES` (`job-queue.ts`). En fyllning är en post i
 * `STARTUP_BACKFILLS` med namn, ägar-issue och slutdatum; `runStartupBackfills`
 * kör posterna i tur och ordning och loggar start, resultat och fel på samma
 * sätt. Ett fel i en fyllning loggas och stoppar varken nästa fyllning eller
 * servern.
 *
 * En fyllning är tillfällig: den flyttar äldre rader till en ny form, och när
 * alla rader är flyttade gör den ingenting. `removeBy` är dagen då den senast
 * ska vara borttagen; ett enhetstest fäller CI när dagen har passerats, och
 * ägar-issuet beskriver hur man ser att den kan tas bort.
 */

import type { OrganizationId } from "@/lib/shared/schemas/ids";
import type { Repositories } from "../repositories/repositories";
import { backfillBadDebtWriteOffs } from "./bad-debt-write-off-backfill";
import { backfillDeadlineTasks } from "./deadline-task-backfill";
import { backfillDocumentKinds } from "./document-kinds-backfill";
import { backfillPublicAssignmentTypes } from "./public-assignment-backfill";

/** Det en fyllning får av servern. */
export interface StartupBackfillDeps {
  /** Typade repos mot den auktoritativa databasen. */
  repos: Repositories;
  /** Byråerna som fylls (server-first: `AVA_ORGANIZATION_ID`). */
  organizationIds: readonly OrganizationId[];
  /** Fel per rad eller byrå; fyllningen fortsätter med nästa. */
  onError: (message: string) => void;
}

/** Ett issue: en URL eller `owner/repo#N`. */
export type IssueRef = `https://${string}` | `${string}/${string}#${number}`;

/** En dag som `YYYY-MM-DD`. */
export type IsoDate = `${number}-${number}-${number}`;

/** En uppstartsfyllning i registret. */
export interface StartupBackfill {
  /** Namnet i loggen. */
  name: string;
  /** Kör fyllningen; svarar med en rad som sammanfattar resultatet. */
  run(deps: StartupBackfillDeps): Promise<string>;
  /** Issuet som äger borttagningen. */
  ownerIssue: IssueRef;
  /** Senaste dagen fyllningen får finnas kvar; testet fäller CI efter den. */
  removeBy: IsoDate;
}

/** De uppstartsfyllningar server-first kör, i den här ordningen. */
export const STARTUP_BACKFILLS: readonly StartupBackfill[] = [
  {
    // ADR 0038 §5: typerna från de äldre fälten → `kinds`, efter omstarten så
    // även rader som den gamla servern hann skriva kommer med.
    name: "dokumenttyper",
    run: async ({ repos, organizationIds, onError }) => {
      const r = await backfillDocumentKinds(repos, organizationIds, onError);
      return `${r.documents} dokument, ${r.organizations} byråer flyttade, ${r.failed} fel`;
    },
    ownerIssue: "https://github.com/ulrik-s/ava-feedback/issues/140",
    removeBy: "2027-01-31",
  },
  {
    // #1640: byråns lista över offentligt uppdrag, en gång (fältet aldrig satt).
    // Ändrar inga ärenden — det görs när admin sparar ärendetyperna.
    name: "offentligt uppdrag",
    run: async ({ repos, organizationIds, onError }) => {
      const r = await backfillPublicAssignmentTypes(repos, organizationIds, onError);
      return `${r.organizations} byråer uppdaterade, ${r.failed} fel`;
    },
    ownerIssue: "https://github.com/ulrik-s/ava-feedback/issues/141",
    removeBy: "2027-01-31",
  },
  {
    // #1809: äldre BAD_DEBT-fakturor utan WriteOff-post får en (ADR 0007), som
    // demons migrate-on-read. Bara INSERT, rör inte bokföringen.
    name: "kundförlust",
    run: async ({ repos, organizationIds, onError }) => {
      const r = await backfillBadDebtWriteOffs(repos, organizationIds, onError);
      return `${r.writeOffs} avskrivningsposter skapade, ${r.failed} fel`;
    },
    ownerIssue: "https://github.com/ulrik-s/ava-feedback/issues/142",
    removeBy: "2027-01-31",
  },
  {
    // #2121: frister i kalendern (`kind = "deadline"`) får var sin uppgift, en
    // gång (härlett id). Bara INSERT i tasks; kalenderraderna rörs inte.
    name: "frister",
    run: async ({ repos, organizationIds, onError }) => {
      const r = await backfillDeadlineTasks(repos, organizationIds, onError);
      return `${r.tasks} uppgifter skapade, ${r.failed} fel`;
    },
    ownerIssue: "https://github.com/ulrik-s/ava-feedback/issues/144",
    removeBy: "2027-01-31",
  },
];

/** Det runnern behöver utöver fyllningarnas beroenden. */
export interface RunStartupBackfillsOptions {
  /** Fyllningarnas beroenden; `onError` sätts av runnern per fyllning. */
  deps: Omit<StartupBackfillDeps, "onError">;
  /** Loggrad. */
  log: (message: string) => void;
  /** Registret (standard `STARTUP_BACKFILLS`); tester skickar ett eget. */
  backfills?: readonly StartupBackfill[];
}

/** Kör en fyllning; ett fel loggas i stället för att kastas. */
async function runOne(backfill: StartupBackfill, opts: RunStartupBackfillsOptions): Promise<void> {
  const prefix = `uppstartsfyllning ${backfill.name}`;
  opts.log(`${prefix}: startar (tas bort senast ${backfill.removeBy}, ${backfill.ownerIssue})`);
  try {
    const summary = await backfill.run({ ...opts.deps, onError: (m) => opts.log(`${prefix}: ${m}`) });
    opts.log(`${prefix}: klar — ${summary}`);
  } catch (err) {
    opts.log(`${prefix}: misslyckades — ${String(err)}`);
  }
}

/**
 * Kör fyllningarna i tur och ordning. Avvisas aldrig: anroparen kan starta den
 * med `void` utan att vänta, och servern serverar under tiden.
 */
export async function runStartupBackfills(opts: RunStartupBackfillsOptions): Promise<void> {
  for (const backfill of opts.backfills ?? STARTUP_BACKFILLS) {
    await runOne(backfill, opts);
  }
}
