/**
 * Typad `fetch`-attrapp (#1102).
 *
 * `globalThis.fetch` bär mer än sin anropssignatur — den har `preconnect`, som
 * en vanlig pilfunktion saknar. Därför slutade 31 testfiler på samma rad:
 *
 *     const fetchFn = (async () => …) as unknown as typeof fetch;
 *
 * En dubbel-cast tystar kompilatorn i stället för att svara den, och regeln som
 * förbjuder dem (ADR 0026) fick undantag på löpande band. `Object.assign` ger
 * samma sak utan cast: funktionen får de fält typen kräver, och om `fetch`
 * växer ett fält till faller det HÄR — på ett ställe — i stället för att tyst
 * accepteras av en cast i varje testfil.
 */

/** En attrapp som svarar likadant på varje anrop. */
export function fetchFake(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
  const fn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => handler(String(input), init);
  return Object.assign(fn, { preconnect: (): void => {} });
}

/** JSON-svar med given status — det överlägset vanligaste behovet. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
