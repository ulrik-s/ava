/**
 * `feedback` — användarnas buggar och förslag → privat intag-repo på GitHub.
 *
 * Porten (`ctx.ports.feedback`) finns bara i server-first med token + repo i
 * env. I webbläsaren (in-process) saknas den → NOT_IMPLEMENTED; klienten
 * anropar därför serverns tRPC direkt (`client/backend/server-feedback.ts`).
 *
 * Texten är användarens och behandlas som data hela vägen: den citeras i
 * issuen, `@`-omnämnanden och HTML-kommentarer neutraliseras, och ägaren
 * markeras FÖRST i issuen där användaren inte kan skriva. Agentkedjan som
 * läser issuen behandlar den likadant (docs/feedback-pipeline.md).
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  FEEDBACK_ATTACHMENT_TYPES, type FeedbackAttachment, feedbackAttachmentRequestSchema,
  feedbackInputSchema, feedbackItemSchema, feedbackReplySchema, feedbackState, INTAKE_LABELS, releaseFromLabels,
  TO_USER_MARKER, userReplyMarker,
  type FeedbackInput, type FeedbackItem, type FeedbackKind, type FeedbackMessage,
} from "@/lib/shared/feedback";
import { log } from "@/lib/shared/observability/logger";
import type { Principal } from "../auth/principal";
import { attachmentMarkdown, attachmentPathsIn, attachmentTypeOf, uploadAttachments, withoutAttachments } from "../feedback/feedback-attachments";
import { releaseLabel } from "../http/health";
import type { FeedbackComment, FeedbackIssue, IFeedbackSink } from "../ports";
import { orgProcedure, router } from "../trpc";

/** Högst så många förfrågningar per användare och timme. */
export const FEEDBACK_PER_HOUR = 10;
/** Högst så många svar i dialogen per användare och timme. */
export const REPLIES_PER_HOUR = 20;
const HOUR_MS = 3_600_000;

// ponytail: gränsen ligger i processens minne — en omstart nollställer den, och
// server-first är en enda process. Flytta till Postgres om servern skalas ut.
const recent = new Map<string, number[]>();

/** Nollställ gränsen (tester). */
export function resetFeedbackRateLimit(): void {
  recent.clear();
}

function assertWithinLimit(key: string, max: number, what: string, now: number): void {
  const times = (recent.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  if (times.length >= max) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Högst ${max} ${what} i timmen — försök igen senare.` });
  }
  recent.set(key, [...times, now]);
}

/** Spara bilagorna (#1788) och ge raderna att lägga sist i texten — tomt utan bilagor. */
async function attachmentLines(sink: IFeedbackSink, attachments: readonly FeedbackAttachment[], now: Date, heading: string): Promise<string> {
  if (attachments.length === 0) return "";
  let saved: Awaited<ReturnType<typeof uploadAttachments>>;
  try {
    saved = await uploadAttachments(sink, attachments, now);
  } catch (e) {
    if (e instanceof TRPCError) throw e;
    // Oftast en token utan `Contents: write` på intag-repot.
    log.warn("feedback.attachment_upload_failed", { message: e instanceof Error ? e.message : String(e), count: attachments.length });
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Bilagorna kunde inte tas emot just nu. Skicka utan bilagor, eller försök igen senare." });
  }
  return `\n\n${heading}${attachmentMarkdown(saved)}`;
}

function requireSink(sink: IFeedbackSink | undefined): IFeedbackSink {
  if (!sink) throw new TRPCError({ code: "NOT_IMPLEMENTED", message: "Förfrågningar är inte konfigurerade på servern." });
  return sink;
}

/** Ägarmarkören — först i issuen, där användarens text aldrig hamnar. */
export function ownerMarker(userId: string): string {
  return `<!-- ava-user:${userId} -->`;
}

/** Användarens text som data: inga omnämnanden, inga dolda kommentarer. */
export function neutralize(text: string): string {
  return text.replace(/@(?=\w)/g, "@​").replace(/<!--/g, "&lt;!--");
}

const KIND_LABEL: Readonly<Record<FeedbackKind, string>> = { bug: INTAKE_LABELS.bug, feature: INTAKE_LABELS.feature };

/** Issuens text: kontext överst (servern), användarens text citerad under. */
export function issueBody(input: FeedbackInput, user: Principal, release: string | undefined, sentAt: Date): string {
  const quoted = neutralize(input.body).split("\n").map((l) => `> ${l}`).join("\n");
  return [
    ownerMarker(user.id),
    `**Typ:** ${input.kind === "bug" ? "Bugg" : "Förslag"}`,
    `**Från:** ${neutralize(user.name)} (${user.role}) · byrå \`${user.organizationId}\``,
    `**Sida:** \`${input.page.replace(/`/g, "")}\``,
    `**Release:** ${release ?? "okänd"}`,
    `**Webbläsare:** ${neutralize(input.userAgent.replace(/[`\n]/g, ""))}`,
    `**Skickad:** ${sentAt.toISOString()}`,
    "",
    "---",
    "",
    quoted,
  ].join("\n");
}

/** Användarens egna förfrågningar (ägarmarkören står först i issuen). */
export function ownedBy(issues: readonly FeedbackIssue[], userId: string): FeedbackIssue[] {
  const marker = ownerMarker(userId);
  return issues.filter((i) => i.body.startsWith(marker));
}

/** Användarens svar som en kommentar: markören först, texten citerad. */
export function replyBody(userId: string, text: string): string {
  return `${userReplyMarker(userId)}\n\n${neutralize(text).split("\n").map((l) => `> ${l}`).join("\n")}`;
}

/** Sidfoten agenterna lägger till ("Generated by Claude Code") hör inte till dialogen. */
const AGENT_FOOTER = /\n*-{3,}\n_Generated by \[Claude Code\]\([^)]*\)_\s*$/;

/** Kommentar → meddelande i dialogen, eller null om den inte är till/från användaren. */
function toMessage(c: FeedbackComment, userId: string): FeedbackMessage | null {
  const reply = userReplyMarker(userId);
  if (c.body.startsWith(reply)) {
    const raw = c.body.slice(reply.length);
    const text = withoutAttachments(raw).trim().split("\n").map((l) => l.replace(/^> ?/, "")).join("\n");
    return { id: c.id, from: "du", body: text, createdAt: c.createdAt, attachments: attachmentPathsIn(raw) };
  }
  if (!c.body.startsWith(TO_USER_MARKER)) return null;
  const body = c.body.slice(TO_USER_MARKER.length).replace(AGENT_FOOTER, "").trim();
  return { id: c.id, from: c.viaApp ? "claude" : "ulrik", body, createdAt: c.createdAt, attachments: [] };
}

/** Dialogen: bara frågor till användaren och användarens egna svar, äldst först. */
export function messagesFrom(comments: readonly FeedbackComment[], userId: string): FeedbackMessage[] {
  return comments.flatMap((c) => toMessage(c, userId) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Användarens förfrågningar med dialog, nyast först. */
export function mineFrom(
  issues: readonly FeedbackIssue[], userId: string, comments: ReadonlyMap<number, readonly FeedbackComment[]> = new Map(),
): FeedbackItem[] {
  return ownedBy(issues, userId)
    .map((i) => ({
      number: i.number,
      title: i.title,
      kind: i.labels.includes(INTAKE_LABELS.bug) ? "bug" as const : "feature" as const,
      state: feedbackState(i.open, i.labels),
      createdAt: i.createdAt,
      release: releaseFromLabels(i.labels),
      messages: messagesFrom(comments.get(i.number) ?? [], userId),
      canReply: i.open && !i.labels.includes(INTAKE_LABELS.delivered),
      attachments: attachmentPathsIn(i.body),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Kommentarerna för de issues som har några (en dialog utan kommentarer kostar inget anrop). */
async function commentsFor(sink: IFeedbackSink, issues: readonly FeedbackIssue[]): Promise<Map<number, FeedbackComment[]>> {
  const withComments = issues.filter((i) => i.comments > 0);
  const lists = await Promise.all(withComments.map((i) => sink.comments(i.number)));
  return new Map(withComments.map((i, n) => [i.number, lists[n] ?? []]));
}

export const feedbackRouter = router({
  /** Skicka en bugg eller ett förslag. */
  submit: orgProcedure
    .input(feedbackInputSchema)
    .output(z.object({ number: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const sink = requireSink(ctx.ports.feedback);
      const now = new Date();
      assertWithinLimit(`submit:${ctx.user.id}`, FEEDBACK_PER_HOUR, "förfrågningar", now.getTime());
      const attachments = await attachmentLines(sink, input.attachments, now, "**Bilagor:**\n");
      const created = await sink.create({
        title: neutralize(input.title),
        body: issueBody(input, ctx.user, releaseLabel(process.env.AVA_RELEASE), now) + attachments,
        labels: [INTAKE_LABELS.request, KIND_LABEL[input.kind]],
      });
      // Bara id:n i loggen — texten kan innehålla klientuppgifter.
      log.info("feedback.submitted", { userId: ctx.user.id, orgId: ctx.orgId, ids: [String(created.number)] });
      return created;
    }),

  /** Mina förfrågningar, var de är, och dialogen om dem. */
  mine: orgProcedure.output(z.array(feedbackItemSchema)).query(async ({ ctx }) => {
    const sink = requireSink(ctx.ports.feedback);
    const mine = ownedBy(await sink.list(), ctx.user.id);
    return mineFrom(mine, ctx.user.id, await commentsFor(sink, mine));
  }),

  /** Svara i dialogen om en av MINA öppna förfrågningar. */
  reply: orgProcedure
    .input(feedbackReplySchema)
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const sink = requireSink(ctx.ports.feedback);
      // Bara ägaren får svara — en annans förfrågan finns inte, sett härifrån.
      const issue = ownedBy(await sink.list(), ctx.user.id).find((i) => i.number === input.number);
      if (!issue) throw new TRPCError({ code: "NOT_FOUND", message: "Förfrågan finns inte." });
      if (!issue.open || issue.labels.includes(INTAKE_LABELS.delivered)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Förfrågan är avslutad — skicka en ny om något återstår." });
      }
      assertWithinLimit(`reply:${ctx.user.id}`, REPLIES_PER_HOUR, "svar", Date.now());
      const attachments = await attachmentLines(sink, input.attachments, new Date(), "");
      await sink.comment(input.number, replyBody(ctx.user.id, input.body) + attachments);
      log.info("feedback.replied", { userId: ctx.user.id, orgId: ctx.orgId, ids: [String(input.number)] });
      return { ok: true as const };
    }),

  /**
   * En bilaga i en av MINA förfrågningar (#1788), för miniatyren eller
   * nedladdningen — repot är privat, så webbläsaren kan inte hämta den själv.
   * Bara bilagor som står i förfrågan eller i användarens egna svar lämnas ut.
   */
  attachment: orgProcedure
    .input(feedbackAttachmentRequestSchema)
    .output(z.object({ type: z.enum(FEEDBACK_ATTACHMENT_TYPES), data: z.string() }))
    .query(async ({ ctx, input }) => {
      const sink = requireSink(ctx.ports.feedback);
      const issue = ownedBy(await sink.list(), ctx.user.id).find((i) => i.number === input.number);
      const mine = issue ? [issue.body, ...(await sink.comments(issue.number)).filter((c) => c.body.startsWith(userReplyMarker(ctx.user.id))).map((c) => c.body)] : [];
      if (!mine.some((body) => attachmentPathsIn(body).includes(input.path))) throw new TRPCError({ code: "NOT_FOUND", message: "Bilagan finns inte." });
      return { type: attachmentTypeOf(input.path), data: await sink.file(input.path) };
    }),
});
