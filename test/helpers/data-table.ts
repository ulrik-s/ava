/**
 * Hjälp för komponenttester som går genom `DataTable` som användaren gör:
 * klick på kolumnrubriken öppnar menyn, och menyn sorterar (#1903).
 */

import { fireEvent, screen, within } from "@testing-library/react";

/** Rubrikcellen vars text (utan sorteringspil) är exakt `label`. */
export function columnHeader(label: string): HTMLElement {
  const th = screen.getAllByRole("columnheader").find(
    (h) => h.querySelector("button span")?.textContent.replace(/ [↑↓]$/, "") === label,
  );
  if (!th) throw new Error(`Kolumnen "${label}" finns inte`);
  return th;
}

/** Raden som texten står på. */
export function rowWith(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`"${text}" står inte i någon rad`);
  return row;
}

/** Öppna kolumnens rubrikmeny. */
export function openColumnMenu(label: string): void {
  fireEvent.click(within(columnHeader(label)).getByRole("button"));
}

/** Sortera på kolumnen via rubrikmenyn. */
export function sortColumn(label: string, dir: "asc" | "desc"): void {
  openColumnMenu(label);
  fireEvent.click(screen.getByRole("button", { name: dir === "asc" ? "Sortera stigande ↑" : "Sortera fallande ↓" }));
}

/** Texterna i ordning, så som raderna står i tabellen (en text per rad). */
export function rowOrder(texts: readonly string[]): string[] {
  const nodes = texts.map((t) => ({ t, row: screen.getByText(t).closest("tr") }));
  const rows = screen.getAllByRole("row");
  const at = (row: Element | null): number => rows.findIndex((r) => r === row);
  return [...nodes].sort((a, b) => at(a.row) - at(b.row)).map((n) => n.t);
}
