/**
 * `computeWorkingSet` (#418, ADR 0022) — beräknar vilka ärenden offline-klienten
 * håller lokalt: *mina aktiva ärenden* (`responsibleLawyerId == jag`) +
 * *kalender-ärenden* (pinnade — vräks aldrig) + *senast öppnade* (fyller upp till
 * budgeten). Övrigt hämtas on-demand online.
 *
 * Ren funktion (ingen I/O) — prefetch-koordinatorn (`WorkingSetCache`) matar in
 * id-mängderna den hämtat och får tillbaka working-set:ens form + pin-mängd.
 */

const ACTIVE = "ACTIVE";

export interface WorkingSetMatter {
  id: string;
  responsibleLawyerId?: string | null;
  status?: string;
}

export interface WorkingSetInput {
  /** Inloggad användare (ägar-matchning). */
  userId: string;
  /** Kandidat-ärenden att välja ur (id + ägare + status). */
  matters: readonly WorkingSetMatter[];
  /** Senast öppnade ärende-id, NYAST FÖRST. */
  recentMatterIds?: readonly string[];
  /** Ärende-id kopplade till kalenderhändelser i fönstret. */
  calendarMatterIds?: readonly string[];
  /** Max antal ärenden i working-set (budget). Pinnade kan överstiga den. */
  budget: number;
}

export interface WorkingSet {
  /** Ärende-id i working-set: pinnade först, sedan senaste (kapat till budget). */
  matterIds: string[];
  /** Pinnade ärenden — vräks aldrig (mina aktiva + kalender). */
  pinned: Set<string>;
}

/** Pin-mängden: mina aktiva ärenden + kalender-ärenden (vräks aldrig). */
function computePinned(input: WorkingSetInput, byId: Map<string, WorkingSetMatter>): Set<string> {
  const pinned = new Set<string>();
  for (const m of input.matters) {
    if (m.responsibleLawyerId === input.userId && (m.status ?? ACTIVE) === ACTIVE) pinned.add(m.id);
  }
  for (const id of input.calendarMatterIds ?? []) {
    if (byId.has(id)) pinned.add(id);
  }
  return pinned;
}

/** Beräkna working-set:ens ärende-mängd + pin-mängd (ADR 0022). */
export function computeWorkingSet(input: WorkingSetInput): WorkingSet {
  const byId = new Map(input.matters.map((m) => [m.id, m]));
  const pinned = computePinned(input, byId);
  const matterIds = [...pinned];
  // Fyll upp med senast öppnade (ej redan pinnade) tills budgeten nås.
  for (const id of input.recentMatterIds ?? []) {
    if (matterIds.length >= input.budget) break;
    if (!pinned.has(id) && byId.has(id)) matterIds.push(id);
  }
  return { matterIds, pinned };
}
