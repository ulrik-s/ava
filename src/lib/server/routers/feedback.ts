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
  feedbackInputSchema, feedbackItemSchema, feedbackState, INTAKE_LABELS, releaseFromLabels,
  type FeedbackInput, type FeedbackItem, type FeedbackKind,
} from "@/lib/shared/feedback";
import { log } from "@/lib/shared/observability/logger";
import type { Principal } from "../auth/principal";
import { releaseLabel } from "../http/health";
import type { FeedbackIssue, IFeedbackSink } from "../ports";
import { orgProcedure, router } from "../trpc";

/** Högst så många förfrågningar per användare och timme. */
export const FEEDBACK_PER_HOUR = 5;
const HOUR_MS = 3_600_000;

// ponytail: gränsen ligger i processens minne — en omstart nollställer den, och
// server-first är en enda process. Flytta till Postgres om servern skalas ut.
const recent = new Map<string, number[]>();

/** Nollställ gränsen (tester). */
export function resetFeedbackRateLimit(): void {
  recent.clear();
}

function assertWithinLimit(userId: string, now: number): void {
  const times = (recent.get(userId) ?? []).filter((t) => now - t < HOUR_MS);
  if (times.length >= FEEDBACK_PER_HOUR) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Högst ${FEEDBACK_PER_HOUR} förfrågningar i timmen — försök igen senare.` });
  }
  recent.set(userId, [...times, now]);
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

/** Användarens egna förfrågningar, nyast först. */
export function mineFrom(issues: readonly FeedbackIssue[], userId: string): FeedbackItem[] {
  const marker = ownerMarker(userId);
  return issues
    .filter((i) => i.body.startsWith(marker))
    .map((i) => ({
      number: i.number,
      title: i.title,
      kind: i.labels.includes(INTAKE_LABELS.bug) ? "bug" as const : "feature" as const,
      state: feedbackState(i.open, i.labels),
      createdAt: i.createdAt,
      release: releaseFromLabels(i.labels),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const feedbackRouter = router({
  /** Skicka en bugg eller ett förslag. */
  submit: orgProcedure
    .input(feedbackInputSchema)
    .output(z.object({ number: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const sink = requireSink(ctx.ports.feedback);
      const now = new Date();
      assertWithinLimit(ctx.user.id, now.getTime());
      const created = await sink.create({
        title: neutralize(input.title),
        body: issueBody(input, ctx.user, releaseLabel(process.env.AVA_RELEASE), now),
        labels: [INTAKE_LABELS.request, KIND_LABEL[input.kind]],
      });
      // Bara id:n i loggen — texten kan innehålla klientuppgifter.
      log.info("feedback.submitted", { userId: ctx.user.id, orgId: ctx.orgId, ids: [String(created.number)] });
      return created;
    }),

  /** Mina förfrågningar och var de är. */
  mine: orgProcedure.output(z.array(feedbackItemSchema)).query(async ({ ctx }) =>
    mineFrom(await requireSink(ctx.ports.feedback).list(), ctx.user.id)),
});
