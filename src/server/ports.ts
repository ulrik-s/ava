/**
 * Server-only ports. Routrar importerar bara INTERFACES härifrån —
 * inga konkreta implementationer. Composition root (createContext för
 * server, DemoBootstrap för demo) wirar konkret implementation.
 */

import type { Buffer } from "node:buffer";

// ─── EmailSender ───────────────────────────────────────────────────

export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IEmailSender {
  send(input: SendEmailInput): Promise<void>;
}

// ─── DocumentAnalyzer ──────────────────────────────────────────────

export interface IDocumentAnalyzer {
  /**
   * Schemalägg analys av ett dokument. Implementation kan vara
   * synkron eller asynkron — i prod körs det i bakgrunden via en
   * job-kö. Returnerar void; eventuella suggestions postas via
   * dataStore.documentAnalysisSuggestions.
   */
  analyze(documentId: string): Promise<void>;
}

// ─── SearchIndex ───────────────────────────────────────────────────

export interface SearchHit {
  id: string;
  fileName: string;
  /** Path till filinnehållet i git working copy:n. UI:n använder den för
   *  att öppna dokumentet via OPFS-blob (self-hosted) eller GH Pages (demo). */
  storagePath?: string | null;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
  _formatted?: {
    content?: string;
    fileName?: string;
  };
}

export interface SearchResponse {
  hits: SearchHit[];
  estimatedTotalHits: number;
}

export interface IndexableDocument {
  id: string;
  fileName: string;
  content: string;
  matterId: string;
  matterNumber: string;
  matterTitle: string;
  organizationId: string;
}

export interface ISearchIndex {
  search(query: string, organizationId: string, limit?: number): Promise<SearchResponse>;
  upsert(doc: IndexableDocument): Promise<void>;
  remove(id: string): Promise<void>;
}

// ─── PaymentScanner ────────────────────────────────────────────────

export interface IPaymentScanner {
  scan(organizationId: string): Promise<void>;
}

// ─── Aggregat ──────────────────────────────────────────────────────

/**
 * Alla ports som tillhör en tRPC-`Context`. Routrar deklarerar bara
 * de ports de behöver via property-access; oanvända ports kostar
 * inget eftersom de wir:as som no-ops i demo-bootstrappen.
 */
export interface IPorts {
  email: IEmailSender;
  documentAnalyzer: IDocumentAnalyzer;
  searchIndex: ISearchIndex;
  paymentScanner: IPaymentScanner;
}

// Buffer-typen exporteras så impl:erna kan importera utan Node:
export type { Buffer };
