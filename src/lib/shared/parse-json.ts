import { z } from "zod";

/**
 * Enda vägen från JSON-text till ett typat värde (#1469). `JSON.parse` ger
 * `any`, som sedan castades på tolv ställen; här valideras texten alltid mot
 * ett zod-schema. Direkt `JSON.parse` är förbjuden av ESLint
 * (`no-restricted-syntax`) — de två anropen nedan är de enda tillåtna.
 */
export function parseJsonWith<S extends z.ZodType>(schema: S, text: string): z.output<S> {
  // eslint-disable-next-line no-restricted-syntax -- den enda råa JSON.parse: resultatet går rakt in i zod
  return schema.parse(JSON.parse(text));
}

/** Utfallet av `safeParseJsonWith`: som zods safeParse, där ogiltig JSON också är ett fel. */
export type JsonParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

/** Som `parseJsonWith` men utan kast: ogiltig JSON blir ett vanligt zod-fel. */
export function safeParseJsonWith<S extends z.ZodType>(schema: S, text: string): JsonParseResult<z.output<S>> {
  let raw: unknown;
  try {
    // eslint-disable-next-line no-restricted-syntax -- se parseJsonWith
    raw = JSON.parse(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ogiltig JSON";
    return { success: false, error: new z.ZodError([{ code: "custom", message, path: [], input: text }]) };
  }
  return schema.safeParse(raw);
}
