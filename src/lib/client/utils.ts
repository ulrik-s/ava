import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}:${mins.toString().padStart(2, "0")}`;
}

export function formatCurrency(amountInOre: number): string {
  return new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
  }).format(amountInOre / 100);
}

/** Svensk pluralisering av "ändring": 1 → "ändring", annars "ändringar".
 *  Delas av sync-pillarna (sync-status-pill + sync-diagnostics). */
export function pluralChanges(n: number): string {
  return `ändring${n === 1 ? "" : "ar"}`;
}
