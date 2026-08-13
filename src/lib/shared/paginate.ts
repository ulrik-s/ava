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
