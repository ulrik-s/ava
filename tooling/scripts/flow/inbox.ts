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
 * Utan den loggar klockan bara vad som skulle flyttas. Nekar GitHub en flytt
 * varnar klockan och går vidare: de andra flyttarna, PR:ernas klocka och
 * CI-stegen ska inte vänta på en token.
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

/** Flyttar en förfrågan till inkorgen och märker den där. Ger [gammalt, nytt nummer]. */
function moveOne(issue: OpenItem, mover: Mover): [number, number] {
  const n = mover.source.transferIssue(issue.number, mover.intakeRepo);
  mover.intake.addLabel(n, "intern");
  mover.intake.addLabel(n, issue.labels.includes("bug") ? "bugg" : "förslag");
  return [issue.number, n];
}

/**
 * Flyttar förfrågningarna i kodrepot till inkorgen. Ger [gammalt, nytt nummer]
 * per flyttad issue. Utan `mover` (ingen token) eller i rapportläge loggas bara.
 * En flytt som inte blir klar (GitHub nekar den, eller märkningen) ger en
 * varning på körningen (`::warning::`) och räknas inte som flyttad.
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
  return stray.flatMap((i): Array<[number, number]> => {
    try {
      const moved = moveOne(i, mover);
      log(`#${moved[0]} → ${mover.intakeRepo}#${moved[1]} (intern)`);
      return [moved];
    } catch (e) {
      log(`::warning::flytten av #${i.number} till ${mover.intakeRepo} blev inte klar: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  });
}

/** Flaggan för internt arbete, och den för en användares förfrågan. */
const INTERN = "intern";
const USER_REQUEST = "user-request";

/** En del (sub-issue) utan flagga, och dess förälder i samma repo. */
export interface OrphanedPart { number: number; parent: number }

/**
 * Delar av en förfrågan i `repo` som saknar både `intern` och `user-request`
 * (#2073). Loop 1 delar upp en förfrågan i sub-issues, men en agent får inte
 * sätta `intern`: delen stod utan flagga, och loop 1 tog den aldrig.
 */
export function orphanedParts(items: readonly OpenItem[], repo: string): OrphanedPart[] {
  return items.flatMap((i) => {
    const flagged = i.labels.includes(INTERN) || i.labels.includes(USER_REQUEST);
    return !i.isPr && !flagged && i.parent?.repo === repo ? [{ number: i.number, parent: i.parent.number }] : [];
  });
}

/**
 * Sätter `intern` på delarna vars förälder är intern, med en kommentar. Ger
 * delarnas nummer. Föräldern kan vara stängd (uppdelad), så dess etiketter
 * läses för sig, en gång per förälder. I rapportläge loggas bara.
 */
export function markInternalParts(gh: GitHub, repo: string, ctx: { enforce: boolean; log: (line: string) => void }): number[] {
  const parentLabels = new Map<number, string[]>();
  return orphanedParts(gh.openItems(), repo).flatMap(({ number, parent }) => {
    try {
      const labels = parentLabels.get(parent) ?? gh.labelsOf(parent);
      parentLabels.set(parent, labels);
      if (!labels.includes(INTERN)) return [];
      markPart(gh, number, parent, ctx);
      return [number];
    } catch (e) {
      ctx.log(`::warning::#${number}: föräldern #${parent} gick inte att läsa: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  });
}

function markPart(gh: GitHub, n: number, parent: number, ctx: { enforce: boolean; log: (line: string) => void }): void {
  if (!ctx.enforce) { ctx.log(`#${n}: del av #${parent} (intern) — intern saknas (bara rapport)`); return; }
  gh.addLabel(n, INTERN);
  gh.comment(n, `Flödesvakten: del av #${parent}, som är intern. Etiketten \`intern\` är satt, så att loop 1 tar den.`);
  ctx.log(`#${n}: del av #${parent} (intern) — intern satt`);
}
