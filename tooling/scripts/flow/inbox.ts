/**
 * Inkorgen för allt arbete: nytt arbete börjar som en förfrågan i ava-feedback
 * och går genom intagets flöde — loop 1 verifierar, Ulrik beslutar
 * (`verifierad`), loop 2 bryter ner i arbetsorder. I kodrepot hör bara
 * arbetsorder hemma. En issue där utan någon av flaggorna nedan är en
 * förfrågan i fel repo: klockan flyttar den till inkorgen som `intern` (och
 * `bugg` eller `förslag`), och loop 1 tar den därifrån.
 *
 * Ett issue som byggs direkt i en session (issue + PR i kodrepot) får vara
 * kvar: det flyttas bara när det är äldre än `GRACE_MS` och ingen öppen PR
 * stänger det.
 *
 * Flytten kräver en token som når båda repona (`FLOW_TRANSFER_TOKEN`, Ulriks).
 * Utan den loggar klockan bara vad som skulle flyttas.
 */
import type { GitHub, OpenItem } from "./github";

/** Det som hör hemma i kodrepot: loop 2:s arbetsorder, loop 5:s förslag och veckorapport. */
export const STAYS_IN_CODE_REPO: readonly string[] = ["agent-task", "refaktorisering", "arkitektur-rapport"];

/** Så länge får ett nytt issue i kodrepot vänta på sin PR innan det räknas som en förfrågan. */
export const GRACE_MS = 2 * 3_600_000;

/** Öppna issues i kodrepot som är förfrågningar, inte arbetsorder (eller direkt arbete med en PR). */
export function strayIssues(items: readonly OpenItem[], now: number, hasOpenPr: (n: number) => boolean): OpenItem[] {
  return items.filter((i) =>
    !i.isPr && !i.labels.some((l) => STAYS_IN_CODE_REPO.includes(l))
    && now - Date.parse(i.createdAt ?? "") >= GRACE_MS && !hasOpenPr(i.number));
}

/** Kodrepot och inkorgen med en token som når båda. */
export interface Mover { source: GitHub; intake: GitHub; intakeRepo: string }

/**
 * Flyttar förfrågningarna i kodrepot till inkorgen. Ger [gammalt, nytt nummer]
 * per flyttad issue. Utan `mover` (ingen token) eller i rapportläge loggas bara.
 */
export function moveStrayIssues(from: GitHub, mover: Mover | null, ctx: { now: number; enforce: boolean; log: (line: string) => void }): Array<[number, number]> {
  const { enforce, log } = ctx;
  const stray = strayIssues(from.openItems(), ctx.now, (n) => from.hasOpenPr(n));
  if (stray.length === 0) return [];
  if (!mover || !enforce) {
    const why = mover ? "bara rapport" : "ingen FLOW_TRANSFER_TOKEN, flyttas inte";
    log(`förfrågningar i kodrepot: ${stray.map((i) => `#${i.number}`).join(", ")} — ${why}`);
    return [];
  }
  return stray.map((i): [number, number] => {
    const n = mover.source.transferIssue(i.number, mover.intakeRepo);
    mover.intake.addLabel(n, "intern");
    mover.intake.addLabel(n, i.labels.includes("bug") ? "bugg" : "förslag");
    log(`#${i.number} → ${mover.intakeRepo}#${n} (intern)`);
    return [i.number, n];
  });
}
