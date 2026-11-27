/**
 * Sammanslagen ärendesökning (#1642): ärendelistans träffar på ärendets egna
 * fält och jävskontrollens träffar (en part i ärendet) i EN lista, ett ärende
 * per rad, med texterna för kolumnen "Träff".
 *
 * Ren logik utan React: sidan hämtar ärendena (`matter.list`) och jävsträffarna
 * (`conflict.check`) och renderar bara resultatet härifrån. Matchningsreglerna
 * ändras inte: `ownFieldHits` säger bara VILKET av listsökningens fält, eller
 * vilken part (#1870), som stämde (samma skiftlägesokänsliga delsträng som
 * `matter.list`).
 */

import type { MatterRole } from "@/lib/shared/schemas/enums";

/** En jävsträff så som sammanslagningen behöver den (ur `conflict.check`). */
export interface MergeConflictHit {
  matterId: string;
  contactName: string;
  role: MatterRole;
  personalNumber?: string | null | undefined;
  orgNumber?: string | null | undefined;
}

/** Ärendets fält som listsökningen matchar på (ur `matter.list`). */
export interface MergeableMatter {
  id: string;
  matterNumber: string;
  title: string;
  courtCaseNumber?: string | null | undefined;
  previousCourtCaseNumber?: string | null | undefined;
  insuranceReference?: string | null | undefined;
  /** Ärendets parter, KLIENT först (listradens `parties`, #1869). */
  parties: ReadonlyArray<MatterSearchParty>;
}

/** En part i ärendet så som "Träff" visar den: roll och namn (#1870). */
export interface MatterSearchParty {
  role: MatterRole;
  name: string;
}

/** Ett ärende med texterna för "Träff". */
export type MatterWithHits<M> = M & { hits: string[] };

export interface MatterSearchMergeInput<M extends MergeableMatter> {
  /** Söktermen som jävskontrollen kördes med. */
  term: string;
  /** Jävsträffarna, bäst först. */
  conflictHits: readonly MergeConflictHit[];
  /** Ärenderaderna för jävsträffarnas ärenden (valfri ordning). */
  conflictMatters: readonly M[];
  /** Ärendelistans aktuella sida (sökning, filter och sidbläddring som i dag). */
  listMatters: readonly M[];
  /** Rollens visningsnamn ("Motpart"). */
  roleLabel: (role: MatterRole) => string;
}

type FieldReader = (m: MergeableMatter) => string | null | undefined;

/** Listsökningens fält, i den ordning de visas i "Träff". */
const OWN_FIELDS: ReadonlyArray<readonly [string, FieldReader]> = [
  ["Ärendenr", (m) => m.matterNumber],
  ["Titel", (m) => m.title],
  ["Målnummer", (m) => m.courtCaseNumber],
  ["Tidigare målnummer", (m) => m.previousCourtCaseNumber],
  ["Försäkringsreferens", (m) => m.insuranceReference],
];

const fold = (s: string): string => s.toLocaleLowerCase("sv");

/** Nyckeln för en part på raden (roll + namn), för att inte visa den två gånger. */
function partyKey(role: MatterRole, name: string): string {
  return `${role}\u0000${name}`;
}

/**
 * De av ärendets egna fält som innehåller termen (skiftlägesokänsligt), sedan
 * `<roll>: <namn>` för varje part vars namn innehåller termen, i parternas
 * ordning (#1870). Parter vars nyckel (`partyKey`) finns i `skip` visas inte:
 * de står redan som jävsträff på raden.
 */
export function ownFieldHits(
  m: MergeableMatter, term: string, roleLabel: (role: MatterRole) => string, skip: ReadonlySet<string> = new Set(),
): string[] {
  const needle = fold(term.trim());
  if (!needle) return [];
  const fields = OWN_FIELDS.filter(([, read]) => fold(read(m) ?? "").includes(needle)).map(([label]) => label);
  const parties = m.parties
    .filter((p) => fold(p.name).includes(needle) && !skip.has(partyKey(p.role, p.name)))
    .map((p) => `${roleLabel(p.role)}: ${p.name}`);
  return [...fields, ...parties];
}

/** "Motpart: <namn> (<person-/orgnummer>)" — numret bara när det finns. */
export function conflictHitText(hit: MergeConflictHit, roleLabel: (role: MatterRole) => string): string {
  const number = hit.personalNumber || hit.orgNumber;
  return `${roleLabel(hit.role)}: ${hit.contactName}${number ? ` (${number})` : ""}`;
}

/** Jävsträffarnas texter per ärende, i träffarnas ordning (bäst först). */
function hitTextsByMatter(hits: readonly MergeConflictHit[], roleLabel: (role: MatterRole) => string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const hit of hits) {
    const texts = out.get(hit.matterId) ?? [];
    const text = conflictHitText(hit, roleLabel);
    if (!texts.includes(text)) texts.push(text);
    out.set(hit.matterId, texts);
  }
  return out;
}

/** Jävsträffarnas parter per ärende, som `partyKey`-nycklar. */
function hitKeysByMatter(hits: readonly MergeConflictHit[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const hit of hits) {
    const keys = out.get(hit.matterId) ?? new Set<string>();
    keys.add(partyKey(hit.role, hit.contactName));
    out.set(hit.matterId, keys);
  }
  return out;
}

/**
 * En lista, ett ärende per rad: jävsträffarnas ärenden överst (bäst först),
 * sedan ärendelistans sida utan de ärenden som redan visas överst.
 */
export function mergeMatterSearch<M extends MergeableMatter>(input: MatterSearchMergeInput<M>): Array<MatterWithHits<M>> {
  const { term, roleLabel } = input;
  const rows = new Map(input.conflictMatters.map((m) => [m.id, m]));
  const skips = hitKeysByMatter(input.conflictHits);
  const top: Array<MatterWithHits<M>> = [];
  for (const [id, texts] of hitTextsByMatter(input.conflictHits, roleLabel)) {
    const m = rows.get(id);
    if (m) top.push({ ...m, hits: [...ownFieldHits(m, term, roleLabel, skips.get(id)), ...texts] });
  }
  const shown = new Set(top.map((m) => m.id));
  const rest = input.listMatters
    .filter((m) => !shown.has(m.id))
    .map((m) => ({ ...m, hits: ownFieldHits(m, term, roleLabel) }));
  return [...top, ...rest];
}
