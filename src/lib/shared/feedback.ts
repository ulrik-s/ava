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
export const FEEDBACK_STATES = ["mottagen", "vantar_pa_dig", "finns_redan", "dubblett", "undersokt", "ej_bekraftad", "verifierad", "pagar", "levererad", "avslutad"] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

export const FEEDBACK_STATE_LABEL: Readonly<Record<FeedbackState, string>> = {
  mottagen: "Mottagen",
  vantar_pa_dig: "Väntar på ditt svar",
  finns_redan: "Finns redan i AVA",
  dubblett: "Hanteras ihop med en tidigare förfrågan",
  undersokt: "Undersökt — väntar på beslut",
  ej_bekraftad: "Kunde inte bekräftas",
  verifierad: "Verifierad",
  pagar: "Under arbete",
  levererad: "Levererad",
  avslutad: "Avslutad",
};

/**
 * Vem ett meddelande i dialogen kommer från. `claude` = verifieringsagenten,
 * `ulrik` = Ulrik själv, `du` = användaren som skickade förfrågan.
 */
export const MESSAGE_AUTHORS = ["claude", "ulrik", "du"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

export const feedbackMessageSchema = z.object({
  id: z.number(),
  from: z.enum(MESSAGE_AUTHORS),
  body: z.string(),
  createdAt: z.string(),
});
export type FeedbackMessage = z.infer<typeof feedbackMessageSchema>;

export const feedbackItemSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  kind: z.enum(FEEDBACK_KINDS),
  state: z.enum(FEEDBACK_STATES),
  createdAt: z.string(),
  /** Releasen den levererades i, om den finns (etiketten `release:vX.Y.Z`). */
  release: z.string().nullable(),
  /** Dialogen med användaren (bara det som är till/från användaren), äldst först. */
  messages: z.array(feedbackMessageSchema),
  /** Går det att svara (öppen och inte levererad)? */
  canReply: z.boolean(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

/** Svar från användaren i dialogen. */
export const feedbackReplySchema = z.object({
  number: z.number().int().positive(),
  body: z.string().trim().min(1, "Skriv ett svar.").max(5000),
});
export type FeedbackReply = z.infer<typeof feedbackReplySchema>;

/**
 * Markör först i en kommentar som är skriven TILL användaren (frågor från
 * verifieringsagenten eller Ulrik). Bara sådana kommentarer — och användarens
 * egna svar — visas i AVA; rapporter och interna anteckningar syns aldrig.
 */
export const TO_USER_MARKER = "<!-- till-anvandaren -->";

/** Markör först i användarens svar (skrivs av servern, aldrig av användaren). */
export function userReplyMarker(userId: string): string {
  return `<!-- ava-user-reply:${userId} -->`;
}

/**
 * Avslutad, levererad eller fanns redan — inget mer händer, så den kan ligga
 * undanstoppad. En `finns_redan` går fortfarande att svara på: skriver
 * användaren att det inte hjälpte tar verifieringen upp den igen.
 */
export function isFinished(item: FeedbackItem): boolean {
  return item.state === "levererad" || item.state === "avslutad" || item.state === "finns_redan";
}

/** Senaste aktiviteten: senaste meddelandet, annars när förfrågan skickades. */
export function lastActivity(item: FeedbackItem): string {
  return item.messages.at(-1)?.createdAt ?? item.createdAt;
}

/**
 * Arbetar Claude med förfrågan just nu? Ja när den är ny (undersöks) eller när
 * användaren skrev sist (svaret läses). Flödesvakten startar agenten inom
 * någon minut i båda fallen. Ger texten som visas med den pulserande pricken.
 */
export function claudeWorkingText(item: FeedbackItem): string | null {
  if (isFinished(item)) return null;
  if (item.messages.at(-1)?.from === "du") return "Claude tittar på ditt svar…";
  return item.state === "mottagen" ? "Claude undersöker din förfrågan…" : null;
}

/** Arbetar Claude med någon av förfrågningarna? Då hämtas listan om oftare. */
export function anyClaudeWorking(items: readonly FeedbackItem[]): boolean {
  return items.some((i) => claudeWorkingText(i) !== null);
}

/** Hur angelägen raden är för användaren: lägre först. */
function urgency(item: FeedbackItem, seen: Readonly<Record<string, string>>): number {
  if (hasUnread(item, seen)) return 0;
  // Har användaren redan svarat väntar den inte längre på hen.
  if (item.state === "vantar_pa_dig" && claudeWorkingText(item) === null) return 1;
  return isFinished(item) ? 3 : 2;
}

/**
 * Ordningen i listan: oläst först, sedan det som väntar på svar, sedan
 * pågående, sist avslutade — inom varje grupp senaste aktivitet först.
 */
export function sortForList(items: readonly FeedbackItem[], seen: Readonly<Record<string, string>>): FeedbackItem[] {
  return [...items].sort((a, b) =>
    urgency(a, seen) - urgency(b, seen) || lastActivity(b).localeCompare(lastActivity(a)));
}

/** Hur många förfrågningar som har ett meddelande till användaren som inte lästs. */
export function unreadCount(items: readonly FeedbackItem[], seen: Readonly<Record<string, string>>): number {
  return items.filter((i) => hasUnread(i, seen)).length;
}

/** Finns ett meddelande till användaren som är nyare än när hen senast läste? */
export function hasUnread(item: FeedbackItem, seen: Readonly<Record<string, string>>): boolean {
  const last = item.messages.filter((m) => m.from !== "du").at(-1);
  if (!last) return false;
  const seenAt = seen[String(item.number)];
  return seenAt === undefined || last.createdAt > seenAt;
}

/**
 * Etiketterna i intag-repot. Samma namn som `tooling/agents/labels.json` och
 * agentpromptarna — ändras de, ändras alla tre.
 */
export const INTAKE_LABELS = {
  request: "user-request",
  bug: "bugg",
  feature: "förslag",
  /** Verifieringsagenten har undersökt och skrivit sin rapport. */
  investigated: "undersökt",
  /** …och kunde inte bekräfta buggen/behovet. */
  notConfirmed: "ej-bekräftad",
  /** Ulriks beslut, satt för hand i GitHub — den enda grinden in i kedjan. */
  verified: "verifierad",
  /** En fråga till användaren väntar på svar (sätts av agenten eller Ulrik). */
  waitingForUser: "väntar-på-användaren",
  /** Samma sak som en äldre förfrågan — följer originalet till leverans. */
  duplicate: "dubblett",
  /** Fanns redan (eller var avsett beteende); användaren har fått veta hur. */
  alreadyExists: "finns-redan",
  brokenDown: "nedbruten",
  delivered: "levererad",
} as const;

/** Öppen issue: första etiketten i listan som finns avgör statusen. */
const OPEN_STATE_BY_LABEL: ReadonlyArray<readonly [string, FeedbackState]> = [
  [INTAKE_LABELS.waitingForUser, "vantar_pa_dig"],
  [INTAKE_LABELS.alreadyExists, "finns_redan"],
  [INTAKE_LABELS.duplicate, "dubblett"],
  [INTAKE_LABELS.brokenDown, "pagar"],
  [INTAKE_LABELS.verified, "verifierad"],
  [INTAKE_LABELS.notConfirmed, "ej_bekraftad"],
  [INTAKE_LABELS.investigated, "undersokt"],
];

/** Status ur issuens läge och etiketter. Levererad vinner över allt annat. */
export function feedbackState(open: boolean, labels: readonly string[]): FeedbackState {
  if (labels.includes(INTAKE_LABELS.delivered)) return "levererad";
  if (!open) return "avslutad";
  return OPEN_STATE_BY_LABEL.find(([label]) => labels.includes(label))?.[1] ?? "mottagen";
}

/** `release:v0.5.0` → `v0.5.0`. */
export function releaseFromLabels(labels: readonly string[]): string | null {
  const l = labels.find((x) => x.startsWith("release:"));
  return l ? l.slice("release:".length) : null;
}
