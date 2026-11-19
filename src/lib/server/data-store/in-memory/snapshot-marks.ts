/**
 * Snapshotets märken (#1714, ADR 0037) — vilka köposters rader ett snapshot bär.
 *
 * Alla flikar i en webbläsarprofil delar ETT snapshot av den lokala källan, och
 * varje flik skriver hela sin minneskopia: sista skrivningen vinner. Utan
 * märken tappade snapshotet en annan fliks köade rader, och behöll provisoriska
 * rader vars köpost en annan flik redan hade kvitterat.
 *
 * Bredvid snapshotet sparas därför, i samma transaktion:
 *
 *   - `pending`: köposterna vars optimistiska rader snapshotet innehåller.
 *     En flik som sparar bär över raderna för en ANNAN fliks köade poster ur
 *     det lagrade snapshotet ({@link planCarry}, {@link carryRows}).
 *   - `owed`: rader som skrevs av en post som sedan avgjordes i en annan flik.
 *     Deras läge i snapshotet är inte serverns, och läses om från servern.
 *
 * Vid start jämförs märkena med kön: en märkt post som inte längre ligger i
 * kön är avgjord, och dess rader läses om från servern (`SnapshotTab.adopt`).
 */

import { z } from "zod";
import type { DemoSource } from "@/lib/shared/demo-source";
import { SOURCE_KEY_BY_ENTITY } from "./entity-source-keys";
import { rowRefSchema, type ProcedureTouch } from "./procedure-touches";

const snapshotMarkSchema = z.object({ id: z.string(), refs: z.array(rowRefSchema) });

const snapshotMarksSchema = z.object({
  pending: z.array(snapshotMarkSchema),
  owed: z.array(rowRefSchema),
});

/** En köpost och raderna den skrev i snapshotet. */
export type SnapshotMark = z.infer<typeof snapshotMarkSchema>;
/** Märkena som sparas bredvid ett snapshot. */
export type SnapshotMarks = z.infer<typeof snapshotMarksSchema>;

/** Inga märken: snapshotet bär inga ej synkade ändringar. */
export const NO_MARKS: SnapshotMarks = Object.freeze({ pending: [], owed: [] });

/** De lagrade märkena, eller `null` när inga finns (före #1714) eller de är trasiga. */
export function parseMarks(stored: unknown): SnapshotMarks | null {
  const parsed = snapshotMarksSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

/**
 * Fliken, så som snapshotets persistens ser den (#1714): vilka köade ändringar
 * dess minne bär, och vad den vet om kön.
 */
export interface SnapshotTab {
  /** Märkena för flikens minne just nu. */
  marks(): SnapshotMarks;
  /** Postens plats i kön enligt flikens senaste läsning, eller `null` om den inte ligger där. */
  position(mutationId: string): number | null;
  /** Läs om kön ur lagringen. */
  refresh(): Promise<void>;
  /** Ta emot märkena som sparades med det hydrerade snapshotet (`null` = inga). */
  adopt(stored: SnapshotMarks | null): void;
}

/** Vad en sparning gör med de andra flikarnas märken. */
export interface CarryPlan {
  /**
   * Märkta poster som fliken inte känner igen: nya i en annan flik, eller redan
   * avgjorda. Kön måste läsas om innan något skrivs.
   */
  unknown: string[];
  /** Andra flikars köade poster, vars märken följer med till det nya snapshotet. */
  carried: SnapshotMark[];
  /** Raderna som tas ur det lagrade snapshotet i stället för ur flikens minne. */
  rows: ProcedureTouch[];
}

/** Postens plats i kön, eller `null` om den inte ligger där. */
type QueuePosition = (mutationId: string) => number | null;

const markKey = (ref: ProcedureTouch): string => `${ref.entity}:${ref.id}`;

/**
 * Raderna där en annan fliks post är den SENAST köade ändringen. Rör flikens
 * egen post samma rad och köades den senare, gäller flikens läge: det är det
 * läget uppspelningen (i köordning) slutar i. En post utan känd plats (ny
 * sedan kön lästes) räknas som senast.
 */
function latestElsewhere(carried: readonly SnapshotMark[], mine: SnapshotMarks, position: QueuePosition): ProcedureTouch[] {
  const at = (mark: SnapshotMark): number => position(mark.id) ?? Number.POSITIVE_INFINITY;
  const own = new Map<string, number>();
  for (const mark of mine.pending) {
    for (const ref of mark.refs) own.set(markKey(ref), Math.max(own.get(markKey(ref)) ?? -1, at(mark)));
  }
  return carried.flatMap((mark) => mark.refs.filter((ref) => at(mark) > (own.get(markKey(ref)) ?? -1)));
}

/**
 * Bestäm vilka av det lagrade snapshotets märken som ska bäras över.
 *
 * `settled` = de okända posterna från ett tidigare försök, EFTER att kön lästs
 * om (`null` i första försöket). En post som var okänd då och fortfarande inte
 * ligger i kön är avgjord: dess rader bärs inte över. En post som dykt upp
 * sedan dess bärs över — hellre en rad för mycket (den läses om från servern
 * vid nästa start) än en köad ändring för lite.
 */
export function planCarry(
  stored: SnapshotMarks,
  mine: SnapshotMarks,
  position: QueuePosition,
  settled: ReadonlySet<string> | null,
): CarryPlan {
  const own = new Set(mine.pending.map((m) => m.id));
  const foreign = stored.pending.filter((m) => !own.has(m.id));
  const unknown = settled ? [] : foreign.filter((m) => position(m.id) === null).map((m) => m.id);
  if (unknown.length > 0) return { unknown, carried: [], rows: [] };
  const carried = foreign.filter((m) => position(m.id) !== null || settled?.has(m.id) === false);
  return { unknown, carried, rows: latestElsewhere(carried, mine, position) };
}

type Row = Record<string, unknown>;
type Rows = Record<string, Row[] | undefined>;

/** Radernas id per källnyckel (en okänd entitet hoppas över). */
function idsByKey(refs: readonly ProcedureTouch[]): Map<string, Set<string>> {
  const ids = new Map<string, Set<string>>();
  for (const ref of refs) {
    const key = SOURCE_KEY_BY_ENTITY[ref.entity];
    if (key) ids.set(key, (ids.get(key) ?? new Set<string>()).add(ref.id));
  }
  return ids;
}

/** Byt raderna `ids` mot de lagrade (på sin plats); en rad som saknas i lagringen tas bort. */
function carryInto(rows: readonly Row[], stored: readonly Row[], ids: ReadonlySet<string>): Row[] {
  const from = new Map(stored.filter((r) => typeof r.id === "string" && ids.has(r.id)).map((r) => [r.id, r]));
  const kept = rows.flatMap((row) => {
    if (typeof row.id !== "string" || !ids.has(row.id)) return [row];
    const carried = from.get(row.id);
    from.delete(row.id);
    return carried ? [carried] : [];
  });
  return [...kept, ...from.values()];
}

/**
 * Snapshotet som ska skrivas: flikens källa, med raderna `refs` (andra flikars
 * köade ändringar) tagna ur det lagrade snapshotet. Flikens egen källa ändras
 * inte — den får raderna från servern när posterna har spelats upp.
 */
export function carryRows(source: DemoSource, stored: unknown, refs: readonly ProcedureTouch[]): DemoSource {
  // DemoSource är en post av radlistor per källnyckel; nycklarna slås upp
  // dynamiskt här, så listorna läses som rader med okända fält.
  const out: Rows = { ...(source as Rows) };
  const from = (typeof stored === "object" && stored !== null ? stored : {}) as Rows;
  for (const [key, ids] of idsByKey(refs)) out[key] = carryInto(out[key] ?? [], from[key] ?? [], ids);
  return out;
}
