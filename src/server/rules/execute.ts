/**
 * Regel-executor.
 *
 * Tar emot en regel, ett triggande event och en kontext med side-effect-handlers,
 * och kör stegen i ordning. Returnerar information om vad som hände
 * (vilka steg som körde, eventuella fel, HTTP-respons om regeln var HTTP-triggad).
 *
 * Se `docs/architecture-future.md` §2.2 för step-typ-katalogen.
 */

import jsonLogic from "json-logic-js";
import type { AvaRule, RuleStep } from "./schema";
import type { AvaEvent } from "../events/schema";
import { templateValue, lookup } from "./template";
import type { IDataStore } from "../data-store/IDataStore";

export type StepHandlers = {
  /** Skicka mail. Returnerar `false` om idempotency-key blockerade. */
  sendEmail: (args: { template: string; to: string; vars?: Record<string, unknown>; idempotencyKey?: string }) => Promise<boolean>;

  /** Uppdatera matter-fält. */
  updateMatter: (matterId: string, patch: Record<string, unknown>) => Promise<void>;

  /** AI-extraktion på dokument. */
  extractFromDocument: (args: { documentId: string; schema: Record<string, unknown>; into: string }) => Promise<void>;

  /** Skapa task för användare. */
  createTask: (args: { assignTo: string; title: string; dueAt?: string }) => Promise<void>;
};

export type ExecutionContext = {
  rule: AvaRule;
  event: AvaEvent;
  dataStore: IDataStore;
  handlers: StepHandlers;
  /** Extra request-bound data, t.ex. HTTP-body för http-triggers. */
  request?: Record<string, unknown>;
};

export type ExecutionResult = {
  ruleId: string;
  ok: boolean;
  stepsRan: number;
  httpResponse?: { status: number; body?: unknown };
  error?: { step: number; message: string };
};

/** Bygg context-objekt som `{{var}}`-templating och predikat ser. */
function templateContext(ctx: ExecutionContext, loopBindings?: Record<string, unknown>): Record<string, unknown> {
  return {
    event: ctx.event,
    payload: ctx.event.payload,
    actor: ctx.event.actor,
    rule: { id: ctx.rule.id, name: ctx.rule.name, ownerId: ctx.rule.ownerId },
    request: ctx.request ?? {},
    ...(loopBindings ?? {}),
  };
}

/** Utvärdera ett JsonLogic-predikat. */
function evalPredicate(predicate: unknown, data: Record<string, unknown>): boolean {
  if (predicate == null) return true;
  try {
    return !!jsonLogic.apply(predicate as never, data);
  } catch {
    return false;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Huvudloop: kör en lista av steg. Returneras tidigt på fel eller http.respond. */
async function runSteps(steps: RuleStep[], ctx: ExecutionContext, depth = 0, loopBindings?: Record<string, unknown>): Promise<{ stepsRan: number; httpResponse?: { status: number; body?: unknown }; error?: { step: number; message: string } }> {
  let ran = 0;
  for (let i = 0; i < steps.length; i++) {
    try {
      const subResult = await runStep(steps[i], ctx, depth, loopBindings);
      ran++;
      if (subResult?.httpResponse) return { stepsRan: ran, httpResponse: subResult.httpResponse };
      ran += subResult?.nestedRan ?? 0;
    } catch (err) {
      return { stepsRan: ran, error: { step: i, message: errMessage(err) } };
    }
  }
  return { stepsRan: ran };
}

type StepResult = { httpResponse?: { status: number; body?: unknown }; nestedRan?: number } | undefined;
type StepArgs<T extends RuleStep> = {
  step: T;
  ctx: ExecutionContext;
  tctx: Record<string, unknown>;
  depth: number;
  loopBindings?: Record<string, unknown>;
};

// Pick<RuleStep, ...> — TypeScript discriminerar på `do` så varje handler
// får exakt den step-variant den deklarerar.
type StepHandler<K extends RuleStep["do"]> = (
  args: StepArgs<Extract<RuleStep, { do: K }>>,
) => Promise<StepResult>;

const STEP_HANDLERS: { [K in RuleStep["do"]]: StepHandler<K> } = {
  "emit": async ({ step, ctx, tctx }) => {
    await ctx.dataStore.events.emit({
      type: step.eventType as never,
      source: "rule",
      actor: { kind: "rule", id: ctx.rule.id },
      causedBy: ctx.event.id,
      matterId: ctx.event.matterId,
      payload: templateValue(step.payload, tctx),
    });
    return undefined;
  },

  "email.send": async ({ step, ctx, tctx }) => {
    const to = String(templateValue(step.to, tctx));
    const vars = templateValue(step.vars ?? {}, tctx) as Record<string, unknown>;
    const idempotencyKey = step.idempotencyKey ? String(templateValue(step.idempotencyKey, tctx)) : undefined;
    const sent = await ctx.handlers.sendEmail({ template: step.template, to, vars, idempotencyKey });
    if (sent) {
      await ctx.dataStore.events.emit({
        type: "mail.sent",
        source: "rule",
        actor: { kind: "rule", id: ctx.rule.id },
        causedBy: ctx.event.id,
        matterId: ctx.event.matterId,
        payload: { template: step.template, to, idempotencyKey },
      });
    }
    return undefined;
  },

  "matter.update": async ({ step, ctx, tctx }) => {
    const matterId = String(templateValue(step.matterId, tctx));
    const patch = templateValue(step.patch, tctx) as Record<string, unknown>;
    await ctx.handlers.updateMatter(matterId, patch);
    return undefined;
  },

  "audit.log": async ({ step, ctx, tctx }) => {
    const msg = String(templateValue(step.message, tctx));
    await ctx.dataStore.events.emit({
      type: "user.action",
      source: "rule",
      actor: { kind: "rule", id: ctx.rule.id },
      causedBy: ctx.event.id,
      matterId: ctx.event.matterId,
      payload: { audit: msg },
    });
    return undefined;
  },

  "if": async ({ step, ctx, tctx, depth, loopBindings }) => {
    const branch = evalPredicate(step.cond, tctx) ? step.then : step.else;
    if (!branch?.length) return undefined;
    const sub = await runSteps(branch, ctx, depth + 1, loopBindings);
    if (sub.httpResponse) return { httpResponse: sub.httpResponse };
    if (sub.error) throw new Error(sub.error.message);
    return { nestedRan: sub.stepsRan };
  },

  "for-each": async ({ step, ctx, tctx, depth, loopBindings }) => {
    const items = lookup(tctx, step.items);
    if (!Array.isArray(items)) throw new Error(`for-each.items "${step.items}" är inte en array`);
    let totalNested = 0;
    for (const item of items) {
      const newBindings = { ...(loopBindings ?? {}), [step.as]: item };
      const sub = await runSteps(step.body, ctx, depth + 1, newBindings);
      totalNested += sub.stepsRan;
      if (sub.httpResponse) return { httpResponse: sub.httpResponse, nestedRan: totalNested };
      if (sub.error) throw new Error(sub.error.message);
    }
    return { nestedRan: totalNested };
  },

  "http.respond": async ({ step, tctx }) => {
    const body = step.body !== undefined ? templateValue(step.body, tctx) : undefined;
    return { httpResponse: { status: step.status, body } };
  },

  "llm.extract": async ({ step, ctx, tctx }) => {
    const documentId = String(templateValue(step.documentId, tctx));
    const into = String(templateValue(step.into, tctx));
    await ctx.handlers.extractFromDocument({ documentId, schema: step.schema, into });
    return undefined;
  },

  "task.create": async ({ step, ctx, tctx }) => {
    const assignTo = String(templateValue(step.assignTo, tctx));
    const title = String(templateValue(step.title, tctx));
    const dueAt = step.dueAt ? String(templateValue(step.dueAt, tctx)) : undefined;
    await ctx.handlers.createTask({ assignTo, title, dueAt });
    return undefined;
  },
};

async function runStep(step: RuleStep, ctx: ExecutionContext, depth: number, loopBindings?: Record<string, unknown>): Promise<StepResult> {
  if (depth > 10) throw new Error("Steg-rekursion djupare än 10 — bug eller missdesignad regel");
  const tctx = templateContext(ctx, loopBindings);
  const handler = STEP_HANDLERS[step.do] as StepHandler<typeof step.do>;
  return handler({ step, ctx, tctx, depth, loopBindings } as StepArgs<typeof step>);
}

/** Toppnivå: kör en regel mot ett event. Loggar utfallet som event. */
export async function executeRule(ctx: ExecutionContext): Promise<ExecutionResult> {
  const result = await runSteps(ctx.rule.steps, ctx);

  await ctx.dataStore.events.emit({
    type: result.error ? "rule.failed" : "rule.executed",
    source: "rule",
    actor: { kind: "rule", id: ctx.rule.id },
    causedBy: ctx.event.id,
    matterId: ctx.event.matterId,
    payload: {
      stepsRan: result.stepsRan,
      ...(result.error ? { error: result.error } : {}),
    },
  });

  return {
    ruleId: ctx.rule.id,
    ok: !result.error,
    stepsRan: result.stepsRan,
    httpResponse: result.httpResponse,
    error: result.error,
  };
}
