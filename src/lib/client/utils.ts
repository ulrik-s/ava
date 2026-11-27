import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Svensk pluralisering av "ändring": 1 → "ändring", annars "ändringar".
 *  Delas av sync-pillarna (sync-status-pill + sync-diagnostics). */
export function pluralChanges(n: number): string {
  return `ändring${n === 1 ? "" : "ar"}`;
}
