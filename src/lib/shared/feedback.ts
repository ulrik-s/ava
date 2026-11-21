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

/**
 * Bilagor i en förfrågan eller ett svar (#1788): skärmbilder av hur det gamla
 * systemet fungerar, eller ett Word-dokument som visar hur en mall ska se ut.
 * Bilder kodas om i klienten (då försvinner metadata som plats och kamera);
 * filnamnet skickas aldrig. Servern kontrollerar att innehållet är den typ
 * det säger sig vara och sparar bilagan i intag-repot under ett slumpat namn.
 */
export const FEEDBACK_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const FEEDBACK_ATTACHMENT_TYPES = [
  ...FEEDBACK_IMAGE_TYPES,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
] as const;
export type FeedbackImageType = (typeof FEEDBACK_IMAGE_TYPES)[number];
export type FeedbackAttachmentType = (typeof FEEDBACK_ATTACHMENT_TYPES)[number];
export const MAX_FEEDBACK_ATTACHMENTS = 5;
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Filändelsen för en bilagas typ — sökvägen i repot och namnet när användaren laddar ner. */
export const ATTACHMENT_EXT: Readonly<Record<FeedbackAttachmentType, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
};

/** Vad bilagan kallas för användaren och i issuen: Bild, PDF, Word eller Excel. */
export function attachmentKind(type: FeedbackAttachmentType): string {
  if (isImageType(type)) return "Bild";
  if (type === "application/pdf") return "PDF";
  return type.includes("word") ? "Word" : "Excel";
}

export const isImageType = (t: string): t is FeedbackImageType => (FEEDBACK_IMAGE_TYPES as readonly string[]).includes(t);
export const isAttachmentType = (t: string): t is FeedbackAttachmentType => (FEEDBACK_ATTACHMENT_TYPES as readonly string[]).includes(t);

export const feedbackAttachmentSchema = z.object({
  type: z.enum(FEEDBACK_ATTACHMENT_TYPES),
  /** Innehållet som base64 (utan `data:`-prefix). */
  data: z.string().min(1).max(Math.ceil(MAX_FEEDBACK_ATTACHMENT_BYTES / 3) * 4, "En bilaga är större än 10 MB.").regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
export type FeedbackAttachment = z.infer<typeof feedbackAttachmentSchema>;

const attachmentsSchema = z.array(feedbackAttachmentSchema).max(MAX_FEEDBACK_ATTACHMENTS, `Högst ${MAX_FEEDBACK_ATTACHMENTS} bilagor.`).default([]);

/** Var en bilaga ligger i intag-repot: `attachments/<år-månad>/<uuid>.<typ>`. */
export const FEEDBACK_ATTACHMENT_PATH = /^attachments\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(?:png|jpg|webp|pdf|docx|doc|xlsx|xls)$/;

/** En bilaga i en av användarens egna förfrågningar, för miniatyren eller nedladdningen. */
export const feedbackAttachmentRequestSchema = z.object({ number: z.number().int().positive(), path: z.string().regex(FEEDBACK_ATTACHMENT_PATH) });

/** Vad användaren skickar. Sidan och webbläsaren fylls i av klienten. */
export const feedbackInputSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(3, "Skriv en kort rubrik.").max(120),
  body: z.string().trim().min(10, "Beskriv lite mer (minst 10 tecken).").max(5000),
  /** Sidan användaren stod på, t.ex. `/matters/123` — bara sökvägen. */
  page: z.string().max(300).default(""),
  userAgent: z.string().max(300).default(""),
  attachments: attachmentsSchema,
});
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

/** Var förfrågan befinner sig, sett från användaren. */
export const FEEDBACK_STATES = ["mottagen", "vantar_pa_dig", "finns_redan", "dubblett", "uppdelad", "undersokt", "ej_bekraftad", "verifierad", "pagar", "levererad", "avslutad"] as const;
export type FeedbackState = (typeof FEEDBACK_STATES)[number];

export const FEEDBACK_STATE_LABEL: Readonly<Record<FeedbackState, string>> = {
  mottagen: "Mottagen",
  vantar_pa_dig: "Väntar på ditt svar",
  finns_redan: "Finns redan i AVA",
  dubblett: "Hanteras ihop med en tidigare förfrågan",
  uppdelad: "Uppdelad i flera förfrågningar",
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
  /** Användarens bilagor i meddelandet (sökvägar i intag-repot). */
  attachments: z.array(z.string()).default([]),
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
  /** Bilagorna i själva förfrågan (sökvägar i intag-repot). */
  attachments: z.array(z.string()).default([]),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

/** Svar från användaren i dialogen. */
export const feedbackReplySchema = z.object({
  number: z.number().int().positive(),
  body: z.string().trim().min(1, "Skriv ett svar.").max(5000),
  attachments: attachmentsSchema,
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
 * Avslutad, levererad, uppdelad eller fanns redan — inget mer händer, så den kan ligga
 * undanstoppad. Behöver användaren något mer skickar hen en ny förfrågan.
 */
export function isFinished(item: FeedbackItem): boolean {
  return item.state === "levererad" || item.state === "avslutad" || item.state === "finns_redan" || item.state === "uppdelad";
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
  /** Flera olika saker i samma förfrågan — delad i egna förfrågningar. */
  split: "uppdelad",
  /** Designvägen (loop 2 designar, loop 3 granskar) innan nedbrytningen. */
  designing: "designas",
  designReview: "design-granskas",
  designApproved: "design-godkänd",
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
  // Designen är ett steg efter Ulriks beslut: för användaren är den fortfarande verifierad.
  [INTAKE_LABELS.designing, "verifierad"],
  [INTAKE_LABELS.designReview, "verifierad"],
  [INTAKE_LABELS.designApproved, "verifierad"],
  [INTAKE_LABELS.notConfirmed, "ej_bekraftad"],
  [INTAKE_LABELS.investigated, "undersokt"],
];

/** Status ur issuens läge och etiketter. Levererad vinner över allt annat. */
export function feedbackState(open: boolean, labels: readonly string[]): FeedbackState {
  if (labels.includes(INTAKE_LABELS.delivered)) return "levererad";
  if (labels.includes(INTAKE_LABELS.split)) return "uppdelad";
  // Stängd av Actionen, men användaren ska fortfarande se var funktionen finns.
  if (labels.includes(INTAKE_LABELS.alreadyExists)) return "finns_redan";
  if (!open) return "avslutad";
  return OPEN_STATE_BY_LABEL.find(([label]) => labels.includes(label))?.[1] ?? "mottagen";
}

/** `release:v0.5.0` → `v0.5.0`. */
export function releaseFromLabels(labels: readonly string[]): string | null {
  const l = labels.find((x) => x.startsWith("release:"));
  return l ? l.slice("release:".length) : null;
}
