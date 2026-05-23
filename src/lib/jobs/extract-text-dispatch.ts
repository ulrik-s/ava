"use client";

/**
 * Dispatcher för text-extraction job. Workern körs utanför React-trädet
 * men behöver tRPC + FSA-handle för att skriva text-filen. Vi använder
 * samma pattern som analyze-dispatch.
 */

export interface ExtractTextArgs {
  documentId: string;
  text: string;
  signal?: AbortSignal;
}

type Dispatcher = (args: ExtractTextArgs) => Promise<void>;

let dispatcher: Dispatcher | null = null;

export function setExtractTextDispatcher(fn: Dispatcher | null): void {
  dispatcher = fn;
}

export async function dispatchExtractText(args: ExtractTextArgs): Promise<void> {
  if (!dispatcher) {
    throw new Error("Ingen extract-text-dispatcher registrerad");
  }
  if (args.signal?.aborted) throw new Error("Aborted");
  await dispatcher(args);
}
