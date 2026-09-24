/**
 * pdfjs-dist levererar inga typer för worker-modulen. Det enda pdfjs läser av
 * `globalThis.pdfjsWorker` är `WorkerMessageHandler` (se pdfjs-server-runtime.ts).
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
