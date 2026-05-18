/**
 * Regelschema enligt `docs/architecture-future.md` §2.2.
 *
 * En regel består av:
 *   - identitet + metadata (`id`, `name`, `description`, `ownerId`, `enabled`)
 *   - en `trigger` (event-matchande, schemalagd, eller HTTP-endpoint)
 *   - en lista `steps` som körs i ordning när triggern slår
 *
 * Predikat-språk är JsonLogic. Steg använder `{{var}}`-templating mot
 * event-payload + kontext.
 */

import { z } from "zod";
import { eventTypeSchema } from "../events/schema";

// ─── JsonLogic predikat — minimal Zod-validering ─────────────────────
//
// JsonLogic är rekursivt (en operator pekar på sub-uttryck). Vi använder
// `z.any()` här eftersom djup-validering skulle vara dyrt och redundant —
// `jsonLogic.apply()` kastar vid ogiltig syntax i runtime.
export const jsonLogicSchema = z.unknown();

// ─── Triggers ────────────────────────────────────────────────────────

export const eventTriggerSchema = z.object({
  kind: z.literal("event"),
  type: eventTypeSchema,
  predicate: jsonLogicSchema.optional(),
});

export const scheduleTriggerSchema = z.object({
  kind: z.literal("schedule"),
  cron: z.string().min(1),
  timezone: z.string().optional().default("Europe/Stockholm"),
});

export const httpTriggerSchema = z.object({
  kind: z.literal("http"),
  method: z.enum(["GET", "POST"]),
  /**
   * Sökväg relativt `/api/r/`. Får INTE inkludera ledande slash.
   * Exempel: `"fortnox/payment-received"` blir `POST /api/r/fortnox/payment-received`.
   */
  path: z
    .string()
    .regex(/^[a-zA-Z0-9_-]/, "Path får inte börja med slash eller punkt")
    .regex(/^[a-zA-Z0-9_\-./]+$/, "Path får bara innehålla [A-Za-z0-9_-./]"),
  /**
   * Auth-modeller:
   *   - "user": kräver inloggad användare (vilken som helst i byrån).
   *   - "shared-secret": kräver `Authorization: Bearer <secret>` header.
   *     Secret ligger i env-variabel `AVA_RULES_SHARED_SECRET`.
   *   - "none": ingen auth — använd ENDAST för publika webhook-mottagare
   *     där signaturen verifieras i ett step istället.
   */
  auth: z.enum(["user", "shared-secret", "none"]),
});

export const triggerSchema = z.discriminatedUnion("kind", [
  eventTriggerSchema,
  scheduleTriggerSchema,
  httpTriggerSchema,
]);

export type Trigger = z.infer<typeof triggerSchema>;

// ─── Steg ────────────────────────────────────────────────────────────
//
// Lista över de 9 step-typer som är aktiverade i Fas 1:
//   emit, email.send, matter.update, audit.log, if, for-each,
//   http.respond, llm.extract, task.create
//
// Step-värden får använda {{var}}-templating mot event-payload och kontext.
//
// Eftersom `if`/`for-each` är rekursiva (innehåller `RuleStep[]`) behöver
// vi en `z.lazy()` på toppen.

const valueRefSchema = z.union([z.string(), z.number(), z.boolean(), z.null(), z.record(z.string(), z.unknown()), z.array(z.unknown())]);

interface BaseStep { do: string; }

interface EmitStep extends BaseStep { do: "emit"; eventType: string; payload: Record<string, unknown>; }
interface EmailSendStep extends BaseStep { do: "email.send"; template: string; to: string; vars?: Record<string, unknown>; idempotencyKey?: string; }
interface MatterUpdateStep extends BaseStep { do: "matter.update"; matterId: string; patch: Record<string, unknown>; }
interface AuditLogStep extends BaseStep { do: "audit.log"; message: string; }
interface IfStep extends BaseStep { do: "if"; cond: unknown; then: RuleStep[]; else?: RuleStep[]; }
interface ForEachStep extends BaseStep { do: "for-each"; items: string; as: string; body: RuleStep[]; }
interface HttpRespondStep extends BaseStep { do: "http.respond"; status: number; body?: unknown; }
interface LlmExtractStep extends BaseStep { do: "llm.extract"; documentId: string; schema: Record<string, unknown>; into: string; }
interface TaskCreateStep extends BaseStep { do: "task.create"; assignTo: string; title: string; dueAt?: string; }

export type RuleStep =
  | EmitStep
  | EmailSendStep
  | MatterUpdateStep
  | AuditLogStep
  | IfStep
  | ForEachStep
  | HttpRespondStep
  | LlmExtractStep
  | TaskCreateStep;

// Zod-scheman per step. `if` och `for-each` är rekursiva.
const emitStepSchema = z.object({ do: z.literal("emit"), eventType: z.string(), payload: z.record(z.string(), z.unknown()) });
const emailSendStepSchema = z.object({ do: z.literal("email.send"), template: z.string(), to: z.string(), vars: z.record(z.string(), z.unknown()).optional(), idempotencyKey: z.string().optional() });
const matterUpdateStepSchema = z.object({ do: z.literal("matter.update"), matterId: z.string(), patch: z.record(z.string(), z.unknown()) });
const auditLogStepSchema = z.object({ do: z.literal("audit.log"), message: z.string() });
const httpRespondStepSchema = z.object({ do: z.literal("http.respond"), status: z.number().int(), body: valueRefSchema.optional() });
const llmExtractStepSchema = z.object({ do: z.literal("llm.extract"), documentId: z.string(), schema: z.record(z.string(), z.unknown()), into: z.string() });
const taskCreateStepSchema = z.object({ do: z.literal("task.create"), assignTo: z.string(), title: z.string(), dueAt: z.string().optional() });

export const ruleStepSchema: z.ZodType<RuleStep> = z.lazy(() =>
  z.discriminatedUnion("do", [
    emitStepSchema,
    emailSendStepSchema,
    matterUpdateStepSchema,
    auditLogStepSchema,
    httpRespondStepSchema,
    llmExtractStepSchema,
    taskCreateStepSchema,
    z.object({ do: z.literal("if"), cond: jsonLogicSchema, then: z.array(ruleStepSchema), else: z.array(ruleStepSchema).optional() }),
    z.object({ do: z.literal("for-each"), items: z.string(), as: z.string(), body: z.array(ruleStepSchema) }),
  ]),
);

// ─── Hela regeln ─────────────────────────────────────────────────────

export const avaRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  ownerId: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  steps: z.array(ruleStepSchema).min(1),
});

export type AvaRule = z.infer<typeof avaRuleSchema>;
