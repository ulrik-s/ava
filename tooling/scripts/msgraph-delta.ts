/**
 * Delta-koll mot Graph (#1075) — motsvarigheten till Fortnox `assertVoucherDelta`.
 *
 * Att läsa tillbaka mailet man själv skickade svarar på "landade det vi
 * skickade rätt?". Den frågan kan strukturellt inte se att det landade något
 * MER — en dubblett från en omkörning, ett halvskrivet mail från ett avbrutet
 * jobb. Det kräver aggregat: lista brevlådan FÖRE och EFTER och kräv att
 * skillnaden är exakt det testet skapade.
 *
 * Delta i st.f. absoluta tal är också det som gör att brevlådan ALDRIG behöver
 * tömmas — gamla testmail ligger i både före- och efter-mängden och tar ut sig
 * själva. Det är tur, för städning kräver `Mail.ReadWrite` som vi medvetet inte
 * ber om (se docs/ms-graph.md).
 */

/** Minimal fetch-form, injicerbar i test. */
export type GraphFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Sidstorlek vid listning. AVSIKTLIGT liten.
 *
 * Graph sidnumrerar med `@odata.nextLink`, och utan loopen tystnar listningen
 * vid sidbrytningen — en delta-koll som rapporterar "inget nytt" i stället för
 * att fälla är värre än ingen alls. Med normal sidstorlek hade brevlådan
 * behövt hundratals mail innan loopen kördes första gången, alltså månader av
 * grönt utan att koden någonsin testats.
 *
 * Två per sida betyder att `nextLink` följs vid VARJE körning.
 */
export const PAGE_SIZE = 2;

interface MessageListPage {
  readonly value?: ReadonlyArray<{ readonly id: string }>;
  readonly "@odata.nextLink"?: string;
}

/**
 * Alla meddelande-id:n i brevlådan, över alla sidor.
 *
 * `nextLink` är en KOMPLETT URL från Graph (med skip-token) — den ska följas
 * som den är, inte byggas om av oss.
 */
export async function snapshotMessageIds(
  fetchFn: GraphFetch,
  token: string,
  firstUrl: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let url: string | undefined = firstUrl;
  let pages = 0;
  // Tak mot en trasig nextLink-kedja som annars hade snurrat i evighet.
  const MAX_PAGES = 500;
  while (url && pages < MAX_PAGES) {
    const res = await fetchFn(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Graph listning misslyckades: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const page = (await res.json()) as MessageListPage;
    for (const m of page.value ?? []) ids.add(m.id);
    url = page["@odata.nextLink"];
    pages++;
  }
  if (url) throw new Error(`Graph-listningen tog aldrig slut (${MAX_PAGES} sidor) — trasig nextLink-kedja?`);
  return ids;
}

/**
 * Jämför efter-läget mot före-läget. `expected` är de meddelanden körningen
 * medvetet skapade — allt annat som tillkommit är ett fynd, inte brus.
 */
export function assertMessageDelta(
  before: ReadonlySet<string>, after: ReadonlySet<string>, expected: readonly string[],
): void {
  const added = [...after].filter((id) => !before.has(id)).sort();
  const want = [...expected].sort();

  const unexpected = added.filter((id) => !want.includes(id));
  if (unexpected.length > 0) {
    throw new Error(
      `Brevlådan fick ${unexpected.length} meddelanden som testet inte skapade: `
      + `${unexpected.map((id) => id.slice(0, 24) + "…").join(", ")}. `
      + "Dubblett från en omkörning, eller ett avbrutet jobb — kontrollera brevlådan innan nästa körning.",
    );
  }
  const missing = want.filter((id) => !added.includes(id));
  if (missing.length > 0) {
    throw new Error(
      `Meddelanden saknas i brevlådan trots att sendMail lyckades: `
      + missing.map((id) => id.slice(0, 24) + "…").join(", "),
    );
  }
  const ord = added.length === 1 ? "nytt meddelande" : "nya meddelanden";
  console.log(`  ✓ Delta: exakt ${added.length} ${ord} — inget mer`);
}
