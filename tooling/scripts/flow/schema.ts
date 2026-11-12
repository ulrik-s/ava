/**
 * Schemat för agentkedjans flöde (`tooling/agents/flow.yaml`). Formen
 * valideras här; att flödet hänger ihop (mål finns, etiketter unika …) i
 * `load.ts`.
 */
import { z } from "zod";

/** Vem som får göra en övergång eller sätta en flagga. */
const actorSchema = z.enum(["ulrik", "any"]);

/** `4h` eller `7d`. */
const durationSchema = z.string().regex(/^\d+[hd]$/, "skriv t.ex. 4h eller 7d");

const colorSchema = z.string().regex(/^[0-9a-f]{6}$/, "sex hexsiffror utan #");

const timeoutSchema = z.object({
  after: durationSchema,
  /** Tillståndet saken flyttas till. Saknas för flaggor: då tas flaggan bort. */
  to: z.string().optional(),
  /** Hoppa över timeouten om villkoret gäller. */
  unless: z.enum(["open_pr"]).optional(),
  comment: z.string(),
});

const transitionSchema = z.object({
  to: z.string(),
  by: actorSchema.default("any"),
  /** Övergången kräver Ulrik när saken bär den här flaggan. */
  unless_flag: z.string().optional(),
});

const stateSchema = z.object({
  label: z.string().nullable(),
  color: colorSchema.optional(),
  description: z.string(),
  agent: z.string().nullable(),
  transitions: z.array(transitionSchema).default([]),
  timeout: timeoutSchema.optional(),
});

const flagSchema = z.object({
  color: colorSchema,
  description: z.string(),
  by: actorSchema.default("any"),
  timeout: timeoutSchema.optional(),
});

const machineSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  items: z.enum(["issues", "pulls"]),
  description: z.string(),
  start: z.string(),
  states: z.record(z.string(), stateSchema),
  flags: z.record(z.string(), flagSchema).default({}),
});

const routineSchema = z.object({
  name: z.string(),
  prompt: z.string(),
  trigger_id: z.string().regex(/^trig_\w+$/),
  events: z.array(z.string()).default([]),
});

export const flowSchema = z.object({
  version: z.literal(1),
  ulrik: z.string(),
  machines: z.record(z.string(), machineSchema),
  routines: z.record(z.string(), routineSchema),
  ci: z.object({ hang_minutes: z.number().int().positive() }),
});

/** Hela flödet, validerat. */
export type Flow = z.infer<typeof flowSchema>;
/** En tillståndsmaskin: intaget, kod-issues eller PR:er. */
export type Machine = Flow["machines"][string];
/** Ett tillstånd i en maskin. */
export type State = Machine["states"][string];
/** En timeout på ett tillstånd eller en flagga. */
export type Timeout = NonNullable<State["timeout"]>;
