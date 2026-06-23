/**
 * Regel-executor (executeRule): kör steg i ordning mot ett event med
 * injicerade side-effect-handlers. Täcker varje steg-typ + felhantering,
 * http-short-circuit, if/for-each och templating.
 */

import { describe, it, expect, vi } from "vitest-compat";
import type { AvaEvent } from "@/lib/server/events/schema";
import { executeRule, type ExecutionContext, type StepHandlers } from "@/lib/server/rules/execute";
import type { RuleStep } from "@/lib/server/rules/schema";

function makeHandlers(overrides: Partial<StepHandlers> = {}): StepHandlers {
  return {
    sendEmail: vi.fn(async () => true),
    updateMatter: vi.fn(async () => {}),
    extractFromDocument: vi.fn(async () => {}),
    createTask: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeCtx(
  steps: RuleStep[],
  opts: { payload?: Record<string, unknown>; handlers?: StepHandlers; request?: Record<string, unknown> } = {},
): { ctx: ExecutionContext; emit: ReturnType<typeof vi.fn>; handlers: StepHandlers } {
  const emit = vi.fn(async (input: unknown) => ({ id: "e", ...(input as object) }));
  const handlers = opts.handlers ?? makeHandlers();
  const event = {
    id: "evt-1",
    type: "matter.created",
    payload: opts.payload ?? {},
    actor: { kind: "user", id: "u1" },
    matterId: "m1",
  } as unknown as AvaEvent;
  const ctx = {
    rule: { id: "rule-1", name: "Testregel", ownerId: "u1", steps },
    event,
    dataStore: { events: { emit } },
    handlers,
    request: opts.request,
  } as unknown as ExecutionContext;
  return { ctx, emit, handlers };
}

describe("executeRule — grundflöde", () => {
  it("kör steg i ordning och emittar rule.executed", async () => {
    const { ctx, emit } = makeCtx([{ do: "audit.log", message: "hej" }] as RuleStep[]);
    const res = await executeRule(ctx);
    expect(res.ok).toBe(true);
    expect(res.stepsRan).toBe(1);
    const types = emit.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(types).toContain("user.action"); // audit.log
    expect(types).toContain("rule.executed");
  });
});

describe("executeRule — steg-typer", () => {
  it("emit: emittar event med templatead payload", async () => {
    const { ctx, emit } = makeCtx(
      [{ do: "emit", eventType: "matter.created", payload: { who: "{{payload.name}}" } }] as RuleStep[],
      { payload: { name: "Anna" } },
    );
    await executeRule(ctx);
    const emitted = emit.mock.calls.map((c: unknown[]) => c[0] as { type: string; payload?: Record<string, unknown> });
    const custom = emitted.find((e: { type: string; payload?: Record<string, unknown> }) => e.type === "matter.created");
    expect(custom?.payload).toEqual({ who: "Anna" });
  });

  it("email.send: anropar handler + emittar mail.sent när skickat", async () => {
    const handlers = makeHandlers({ sendEmail: vi.fn(async () => true) });
    const { ctx, emit } = makeCtx(
      [{ do: "email.send", template: "welcome", to: "{{payload.email}}", vars: { x: "1" } }] as RuleStep[],
      { payload: { email: "a@b.se" }, handlers },
    );
    await executeRule(ctx);
    expect(handlers.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ template: "welcome", to: "a@b.se" }));
    expect(emit.mock.calls.some((c: unknown[]) => (c[0] as { type: string }).type === "mail.sent")).toBe(true);
  });

  it("email.send: ingen mail.sent när idempotency blockerar (handler → false)", async () => {
    const handlers = makeHandlers({ sendEmail: vi.fn(async () => false) });
    const { ctx, emit } = makeCtx(
      [{ do: "email.send", template: "welcome", to: "a@b.se" }] as RuleStep[],
      { handlers },
    );
    await executeRule(ctx);
    expect(emit.mock.calls.some((c: unknown[]) => (c[0] as { type: string }).type === "mail.sent")).toBe(false);
  });

  it("matter.update: anropar handler med templatead matterId + patch", async () => {
    const handlers = makeHandlers();
    const { ctx } = makeCtx(
      [{ do: "matter.update", matterId: "{{event.matterId}}", patch: { status: "{{payload.next}}" } }] as RuleStep[],
      { payload: { next: "ARCHIVED" }, handlers },
    );
    await executeRule(ctx);
    expect(handlers.updateMatter).toHaveBeenCalledWith("m1", { status: "ARCHIVED" });
  });

  it("task.create + llm.extract: anropar respektive handler", async () => {
    const handlers = makeHandlers();
    const { ctx } = makeCtx(
      [
        { do: "task.create", assignTo: "{{rule.ownerId}}", title: "Följ upp" },
        { do: "llm.extract", documentId: "doc-1", schema: { foo: "string" }, into: "extracted" },
      ] as RuleStep[],
      { handlers },
    );
    const res = await executeRule(ctx);
    expect(res.ok).toBe(true);
    expect(handlers.createTask).toHaveBeenCalledWith(expect.objectContaining({ assignTo: "u1", title: "Följ upp" }));
    expect(handlers.extractFromDocument).toHaveBeenCalledWith(expect.objectContaining({ documentId: "doc-1", into: "extracted" }));
  });

  it("http.respond: returnerar respons och kortsluter resten", async () => {
    const { ctx, handlers } = makeCtx([
      { do: "http.respond", status: 201, body: { ok: true } },
      { do: "task.create", assignTo: "u1", title: "Ska ej köras" },
    ] as RuleStep[]);
    const res = await executeRule(ctx);
    expect(res.httpResponse).toEqual({ status: 201, body: { ok: true } });
    expect(res.stepsRan).toBe(1);
    expect(handlers.createTask).not.toHaveBeenCalled();
  });
});

describe("executeRule — if / for-each", () => {
  it("if: kör then-grenen när cond är sann", async () => {
    const { ctx, emit } = makeCtx([
      { do: "if", cond: { "==": [1, 1] }, then: [{ do: "audit.log", message: "true-branch" }], else: [{ do: "audit.log", message: "else-branch" }] },
    ] as RuleStep[]);
    const res = await executeRule(ctx);
    expect(res.ok).toBe(true);
    const audits = emit.mock.calls.map((c: unknown[]) => c[0] as { type: string; payload?: { audit?: string } }).filter((e: { type: string; payload?: Record<string, unknown> }) => e.type === "user.action");
    expect(audits.map((a: { type: string; payload?: Record<string, unknown> }) => a.payload?.audit)).toEqual(["true-branch"]);
  });

  it("if: kör else-grenen när cond är falsk", async () => {
    const { ctx, emit } = makeCtx([
      { do: "if", cond: { "==": [1, 2] }, then: [{ do: "audit.log", message: "true-branch" }], else: [{ do: "audit.log", message: "else-branch" }] },
    ] as RuleStep[]);
    await executeRule(ctx);
    const audits = emit.mock.calls.map((c: unknown[]) => c[0] as { type: string; payload?: { audit?: string } }).filter((e: { type: string; payload?: Record<string, unknown> }) => e.type === "user.action");
    expect(audits.map((a: { type: string; payload?: Record<string, unknown> }) => a.payload?.audit)).toEqual(["else-branch"]);
  });

  it("for-each: itererar och binder loop-variabeln", async () => {
    const { ctx, emit } = makeCtx(
      [{ do: "for-each", items: "payload.list", as: "n", body: [{ do: "audit.log", message: "n={{n}}" }] }] as RuleStep[],
      { payload: { list: [1, 2, 3] } },
    );
    const res = await executeRule(ctx);
    expect(res.ok).toBe(true);
    const audits = emit.mock.calls.map((c: unknown[]) => c[0] as { type: string; payload?: { audit?: string } }).filter((e: { type: string; payload?: Record<string, unknown> }) => e.type === "user.action");
    expect(audits.map((a: { type: string; payload?: Record<string, unknown> }) => a.payload?.audit)).toEqual(["n=1", "n=2", "n=3"]);
  });

  it("for-each: kastar (→ rule.failed) när items inte är en array", async () => {
    const { ctx, emit } = makeCtx(
      [{ do: "for-each", items: "payload.notArray", as: "n", body: [{ do: "audit.log", message: "x" }] }] as RuleStep[],
      { payload: { notArray: "inte-en-array" } },
    );
    const res = await executeRule(ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(emit.mock.calls.some((c: unknown[]) => (c[0] as { type: string }).type === "rule.failed")).toBe(true);
  });
});

describe("executeRule — felhantering", () => {
  it("steg-fel → ok:false, error satt, rule.failed emittas", async () => {
    const handlers = makeHandlers({ updateMatter: vi.fn(async () => { throw new Error("DB nere"); }) });
    const { ctx, emit } = makeCtx(
      [{ do: "matter.update", matterId: "m1", patch: { x: 1 } }] as RuleStep[],
      { handlers },
    );
    const res = await executeRule(ctx);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("DB nere");
    expect(res.error?.step).toBe(0);
    expect(emit.mock.calls.some((c: unknown[]) => (c[0] as { type: string }).type === "rule.failed")).toBe(true);
  });

  it("icke-Error-kast → errMessage strängifierar", async () => {
    const handlers = makeHandlers({ updateMatter: vi.fn(async () => { throw "rått fel"; }) });
    const { ctx } = makeCtx([{ do: "matter.update", matterId: "m1", patch: {} }] as RuleStep[], { handlers });
    const res = await executeRule(ctx);
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("rått fel");
  });

  it("ogiltigt predikat (kastar i jsonLogic) → behandlas som falskt → else", async () => {
    const { ctx, emit } = makeCtx([
      { do: "if", cond: { okänd_operator: [1, 2] }, then: [{ do: "audit.log", message: "then" }], else: [{ do: "audit.log", message: "else" }] },
    ] as RuleStep[]);
    await executeRule(ctx);
    const audits = emit.mock.calls.map((c: unknown[]) => c[0] as { type: string; payload?: { audit?: string } }).filter((e: { type: string; payload?: Record<string, unknown> }) => e.type === "user.action");
    expect(audits.map((a: { type: string; payload?: Record<string, unknown> }) => a.payload?.audit)).toEqual(["else"]);
  });

  it("http.respond inuti for-each kortsluter loopen", async () => {
    const { ctx, handlers } = makeCtx(
      [{ do: "for-each", items: "payload.list", as: "n", body: [{ do: "http.respond", status: 202, body: "{{n}}" }, { do: "task.create", assignTo: "u1", title: "ej" }] }] as RuleStep[],
      { payload: { list: [1, 2, 3] } },
    );
    const res = await executeRule(ctx);
    expect(res.httpResponse).toEqual({ status: 202, body: 1 }); // sol-token {{n}} unwrappas → number 1
    expect(handlers.createTask).not.toHaveBeenCalled();
  });
});
