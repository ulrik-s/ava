#!/usr/bin/env bun
/**
 * Flödesvakten för kommentarer: körs av GitHub Actions när en kommentar
 * skrivs. Är det användarens svar från AVA, eller Ulriks svar på något
 * blockerat, startas rätt agent direkt i stället för vid nästa schemalagda
 * körning (tooling/scripts/flow/comments.ts).
 *
 *   bun tooling/scripts/flow-comment.ts        (händelsen i $GITHUB_EVENT_PATH)
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { parseJsonWith } from "@/lib/shared/parse-json";
import { commentTarget } from "./flow/comments";
import { type FetchFn, fire } from "./flow/dispatch";
import { loadFlow } from "./flow/load";
import type { Flow } from "./flow/schema";
import { type Log, machineFor } from "./flow-guard";

const payloadSchema = z.object({
  repository: z.object({ full_name: z.string() }),
  issue: z.object({
    number: z.number(),
    labels: z.array(z.object({ name: z.string() })),
    pull_request: z.unknown().optional(),
  }),
  comment: z.object({
    body: z.string(),
    user: z.object({ login: z.string() }),
    performed_via_github_app: z.unknown().nullable().optional(),
  }),
});
type Payload = z.infer<typeof payloadSchema>;

/** Startar agenten för kommentaren. Ger rutinens id, eller null om inget startades. */
export async function handleComment(
  flow: Flow, payload: Payload, env: Readonly<Record<string, string | undefined>>, fetchFn: FetchFn, log: Log,
): Promise<string | null> {
  const machine = machineFor(flow, payload.repository.full_name, payload.issue.pull_request === undefined ? "issues" : "pulls");
  if (!machine) return null;
  const id = commentTarget(flow, machine, {
    body: payload.comment.body,
    byUlrik: payload.comment.user.login === flow.ulrik && payload.comment.performed_via_github_app == null,
    labels: payload.issue.labels.map((l) => l.name),
  });
  const routine = id === null ? undefined : flow.routines[id];
  if (id === null || !routine) { log(`#${payload.issue.number}: kommentaren startar ingen agent`); return null; }
  const text = `Flödesvakten: nytt svar i ${payload.repository.full_name}#${payload.issue.number}.`;
  return (await fire({ id, routine }, text, env[`ROUTINE_TOKEN_${id}`], fetchFn, log)) ? id : null;
}

if (import.meta.main) {
  const payload = parseJsonWith(payloadSchema, readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"));
  await handleComment(loadFlow(), payload, process.env, fetch, console.log);
}
