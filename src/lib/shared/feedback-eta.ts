/**
 * Uppskattningen av när en förfrågan levereras (#2216) — en enkel, ärlig regel
 * som visas som ett spann i ord, aldrig som ett datum:
 *
 *   dygn ≈ (delar före i kön + återstående delar) ÷ takten + ett halvt dygn till release
 *
 * Takten är mergade agent-PR:er per dygn de senaste 7 dygnen. Väntar en del på
 * ett beslut, eller förfrågan på användarens svar, finns ingen uppskattning —
 * då står det vad den väntar på. Ren funktion: servern räknar, klienten visar.
 */

import type { FeedbackEta } from "./feedback";

/** Underlaget för en uppskattning. */
export interface EtaInput {
  /** Delar som inte är klara. */
  remaining: number;
  /** Delar från andra förfrågningar som ligger före i kön. */
  queueAhead: number;
  /** Takten: delar som blir klara per dygn. */
  perDay: number;
  /** Väntar någon del på ett beslut? */
  blocked: boolean;
  /** Väntar förfrågan på användarens svar? */
  waitingForUser: boolean;
}

/** Från sista mergen till en release: taggen sätts inom några timmar. */
export const RELEASE_LAG_DAYS = 0.5;

/** Trappstegen: första steget vars gräns räcker. */
const STEPS: ReadonlyArray<readonly [number, string]> = [
  [1, "i dag eller i morgon"],
  [2, "inom 1–2 dagar"],
  [7, "inom ungefär en vecka"],
];
const LONGER = "längre än en vecka";

const WORDS = ["noll", "en", "två", "tre", "fyra", "fem", "sex", "sju", "åtta", "nio", "tio", "elva", "tolv"];

/** 2 → "två", 13 → "13". */
function count(n: number): string {
  return WORDS[n] ?? String(n);
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "2 delar" / "en del" — orden för små tal, siffror för stora. */
function parts(n: number): string {
  return `${count(n)} ${n === 1 ? "del" : "delar"}`;
}

/** Spannet i ord för ett antal dygn. */
export function etaLabel(days: number): string {
  return STEPS.find(([max]) => days <= max)?.[1] ?? LONGER;
}

function paceSentence(perDay: number): string {
  const rounded = Math.round(perDay);
  if (rounded < 1) return "AVA bygger just nu färre än en del per dygn.";
  return `AVA bygger ungefär ${parts(rounded)} per dygn just nu.`;
}

/** Skälet i vardaglig svenska: vad som återstår, kön före och takten. */
export function etaReason(remaining: number, queueAhead: number, perDay: number): string {
  const left = `${capitalized(parts(remaining))} återstår.`;
  const ahead = queueAhead > 0 ? ` ${capitalized(parts(queueAhead))} från andra förfrågningar ligger före i kön.` : "";
  return `${left}${ahead} ${paceSentence(perDay)} Uppskattningen uppdateras när något händer.`;
}

/**
 * Uppskattningen: väntar den på användaren eller ett beslut står det så; är
 * alla delar klara kommer den med nästa uppdatering; annars ett spann i ord.
 */
export function estimateDelivery(input: EtaInput): Exclude<FeedbackEta, null> {
  if (input.waitingForUser) return { kind: "waiting", on: "dig" };
  if (input.blocked) return { kind: "waiting", on: "beslut" };
  if (input.remaining <= 0) return { kind: "next_release" };
  // Takten 0 ger oändligt många dygn — "längre än en vecka", aldrig ett fel.
  const days = (input.queueAhead + input.remaining) / input.perDay + RELEASE_LAG_DAYS;
  return { kind: "range", label: etaLabel(days), reason: etaReason(input.remaining, input.queueAhead, input.perDay) };
}
