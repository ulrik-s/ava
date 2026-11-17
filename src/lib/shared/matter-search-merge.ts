/**
 * Sammanslagen ärendesökning (#1642): ärendelistans träffar på ärendets egna
 * fält och jävskontrollens träffar (en part i ärendet) i EN lista, ett ärende
 * per rad, med texterna för kolumnen "Träff".
 *
 * Ren logik utan React: sidan hämtar ärendena (`matter.list`) och jävsträffarna
 * (`conflict.check`) och renderar bara resultatet härifrån. Matchningsreglerna
 * ändras inte: `ownFieldHits` säger bara VILKET av listsökningens fält som
 * stämde (samma fält och samma skiftlägesokänsliga delsträng som `matter.list`).
 */

/** En jävsträff så som sammanslagningen behöver den (ur `conflict.check`). */
export interface MergeConflictHit {
  matterId: string;
  contactName: string;
  role: string;
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
  /** KLIENT-kontakten först (listradens form). */
  contacts: ReadonlyArray<{ contact: { name: string } }>;
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
  roleLabel: (role: string) => string;
}

type FieldReader = (m: MergeableMatter) => string | null | undefined;

/** Listsökningens fält, i den ordning de visas i "Träff". */
const OWN_FIELDS: ReadonlyArray<readonly [string, FieldReader]> = [
  ["Ärendenr", (m) => m.matterNumber],
  ["Titel", (m) => m.title],
  ["Målnummer", (m) => m.courtCaseNumber],
  ["Tidigare målnummer", (m) => m.previousCourtCaseNumber],
  ["Försäkringsreferens", (m) => m.insuranceReference],
  ["Klient", (m) => m.contacts[0]?.contact.name],
];

const fold = (s: string): string => s.toLocaleLowerCase("sv");

/** De av ärendets egna fält som innehåller termen (skiftlägesokänsligt). */
export function ownFieldHits(m: MergeableMatter, term: string): string[] {
  const needle = fold(term.trim());
  if (!needle) return [];
  return OWN_FIELDS.filter(([, read]) => fold(read(m) ?? "").includes(needle)).map(([label]) => label);
}

/** "Motpart: <namn> (<person-/orgnummer>)" — numret bara när det finns. */
export function conflictHitText(hit: MergeConflictHit, roleLabel: (role: string) => string): string {
  const number = hit.personalNumber || hit.orgNumber;
  return `${roleLabel(hit.role)}: ${hit.contactName}${number ? ` (${number})` : ""}`;
}

/** Jävsträffarnas texter per ärende, i träffarnas ordning (bäst först). */
function hitTextsByMatter(hits: readonly MergeConflictHit[], roleLabel: (role: string) => string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const hit of hits) {
    const texts = out.get(hit.matterId) ?? [];
    const text = conflictHitText(hit, roleLabel);
    if (!texts.includes(text)) texts.push(text);
    out.set(hit.matterId, texts);
  }
  return out;
}

/**
 * En lista, ett ärende per rad: jävsträffarnas ärenden överst (bäst först),
 * sedan ärendelistans sida utan de ärenden som redan visas överst.
 */
export function mergeMatterSearch<M extends MergeableMatter>(input: MatterSearchMergeInput<M>): Array<MatterWithHits<M>> {
  const rows = new Map(input.conflictMatters.map((m) => [m.id, m]));
  const top: Array<MatterWithHits<M>> = [];
  for (const [id, texts] of hitTextsByMatter(input.conflictHits, input.roleLabel)) {
    const m = rows.get(id);
    if (m) top.push({ ...m, hits: [...ownFieldHits(m, input.term), ...texts] });
  }
  const shown = new Set(top.map((m) => m.id));
  const rest = input.listMatters
    .filter((m) => !shown.has(m.id))
    .map((m) => ({ ...m, hits: ownFieldHits(m, input.term) }));
  return [...top, ...rest];
}
