/**
 * Frivillig sidning av list-svar (#1011).
 *
 * De stora listorna (`invoice.list`, `paymentPlan.list`, `task.list`) har
 * historiskt returnerat ALLT — hanterbart i UI:t, men en MCP-klient kapar
 * verktygssvar, och `invoice.list` låg över varningströskeln redan på
 * demo-seeden. Sidningen är frivillig med flit: utelämnad `pageSize` beter
 * sig exakt som förut, så inga UI-anropare påverkas; MCP-ytan skickar alltid
 * in sin snåla default (`withPageSizeDefault`).
 */

export interface PageOpts {
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** Skär ut begärd sida; utan `pageSize` returneras listan orörd. */
export function pageSlice<T>(rows: readonly T[], opts: PageOpts | undefined): T[] {
  const pageSize = opts?.pageSize;
  if (pageSize === undefined) return [...rows];
  const page = opts?.page ?? 1;
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

/** En sida plus antalet rader som fanns FÖRE sidningen. */
export interface Page<T> {
  items: T[];
  /** Totalt antal träffar, inte sidans längd — se `pageEnvelope`. */
  total: number;
}

/**
 * Som `pageSlice`, men behåller antalet (#1014).
 *
 * `pageSlice` kastar bort hur många rader som fanns före snittet, och det
 * antalet går inte att återskapa senare: en mottagare som får tio rader kan
 * inte veta om det var allt eller första sidan av hundra. För ett UI spelade
 * det ingen roll så länge listorna var osidade, men MCP-ytan sidar ALLTID
 * (`withPageSizeDefault`) — så där blev tystnaden en felkälla: modellen
 * rapporterade "byrån har 10 fakturor" när den sett en sida.
 *
 * `total` är därför alltid antalet FÖRE sidningen, även när `pageSize`
 * utelämnas (då är det trivialt lika med `items.length`).
 */
export function pageEnvelope<T>(rows: readonly T[], opts: PageOpts | undefined): Page<T> {
  return { items: pageSlice(rows, opts), total: rows.length };
}
