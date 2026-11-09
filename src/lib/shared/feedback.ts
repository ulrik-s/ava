/**
 * Förfrågningar från användarna (buggar och förslag) — kontraktet mellan
 * knappen i appen, serverns `feedback`-router och intag-repot på GitHub.
 *
 * Texten landar i ett PRIVAT repo (`AVA_FEEDBACK_REPO`), aldrig i det publika
 * kodrepot: användare skriver klientnamn och ärendeuppgifter. Agentkedjan som
 * bryter ner förfrågningarna skriver egna, avidentifierade issues i kodrepot.
 * Se docs/feedback-pipeline.md.
 */

import { z } from "zod";

export const FEEDBACK_KINDS = ["bug", "feature"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Vad användaren skickar. Sidan och webbläsaren fylls i av klienten. */
export const feedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(3, "Skriv en kort rubrik.").max(120),
  body: z.string().trim().min(10, "Beskriv lite mer (minst 10 tecken).").max(5000),
  /** Sidan användaren stod på, t.ex. `/matters/123` — bara sökvägen. */
  page: z.string().max(300).default(""),
  userAgent: z.string().max(300).default(""),
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

/** Var förfrågan befinner sig, sett från användaren. */
export const FEEDBACK_STATES = ["mottagen", "godkand", "pagar", "levererad", "avslutad"] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

export const FEEDBACK_STATE_LABEL: Readonly<Record<FeedbackState, string>> = {
  mottagen: "Mottagen",
  godkand: "Godkänd",
  pagar: "Under arbete",
  levererad: "Levererad",
  avslutad: "Avslutad",
};

export const feedbackItemSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  kind: z.enum(FEEDBACK_KINDS),
  state: z.enum(FEEDBACK_STATES),
  createdAt: z.string(),
  /** Releasen den levererades i, om den finns (etiketten `release:vX.Y.Z`). */
  release: z.string().nullable(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

/**
 * Etiketterna i intag-repot. Samma namn som `tooling/agents/labels.json` och
 * agentpromptarna — ändras de, ändras alla tre.
 */
export const INTAKE_LABELS = {
  request: "user-request",
  bug: "bugg",
  feature: "förslag",
  approved: "godkänd",
  brokenDown: "nedbruten",
  delivered: "levererad",
} as const;

/** Status ur issuens läge och etiketter. Levererad vinner över allt annat. */
export function feedbackState(open: boolean, labels: readonly string[]): FeedbackState {
  const has = (l: string): boolean => labels.includes(l);
  if (has(INTAKE_LABELS.delivered)) return "levererad";
  if (!open) return "avslutad";
  if (has(INTAKE_LABELS.brokenDown)) return "pagar";
  return has(INTAKE_LABELS.approved) ? "godkand" : "mottagen";
}

/** `release:v0.5.0` → `v0.5.0`. */
export function releaseFromLabels(labels: readonly string[]): string | null {
  const l = labels.find((x) => x.startsWith("release:"));
  return l ? l.slice("release:".length) : null;
}
