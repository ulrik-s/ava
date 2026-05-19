/**
 * `IDocumentAnalyzer` — port för OCR/text-extraktion + analys av
 * uppladdade dokument.
 *
 * Konkret server-impl: `RealDocumentAnalyzer` (i `adapters/`) som
 * använder Tika + Prisma + LLM-extractor.
 * Demo-impl: `NoopDocumentAnalyzer` som bara svarar tomt.
 */

export interface DocumentAnalysisInput {
  documentId: string;
  buffer: Buffer | Uint8Array;
  mimeType: string;
  organizationId: string;
}

export interface DocumentAnalysisResult {
  text: string;
  metadata: Record<string, unknown>;
  warnings: string[];
}

export interface IDocumentAnalyzer {
  analyze(input: DocumentAnalysisInput): Promise<DocumentAnalysisResult>;
}
