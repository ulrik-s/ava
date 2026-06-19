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
  /**
   * Idempotensnyckel (#504, ADR 0024). Sätts av anroparen till ett stabilt id
   * för den utlösande händelsen (t.ex. fakturans/påminnelsens UUIDv7) → köas
   * som pg-boss `singletonKey` så att en reconcile-replay eller dubbel-trigger
   * inte skickar samma mejl två gånger (som mest ett väntande jobb per nyckel).
   */
  idempotencyKey?: string;
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
  /** Facet-counts per dimension. Räknas på query-MATCH oavsett aktuellt
   *  type-filter — så UI:n kan visa "hur många träffar SKULLE jag få per typ". */
  facets?: {
    documentTypes?: { type: string; count: number }[];
  };
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

export interface ISearchOpts {
  /** Bara dokument vars documentType matchar någon i listan. */
  documentTypes?: string[];
}

export interface ISearchIndex {
  search(query: string, organizationId: string, limit?: number, opts?: ISearchOpts): Promise<SearchResponse>;
  upsert(doc: IndexableDocument): Promise<void>;
  remove(id: string): Promise<void>;
}

// ─── PaymentScanner ────────────────────────────────────────────────

export interface IPaymentScanner {
  scan(organizationId: string): Promise<void>;
}

// ─── ContentStore ──────────────────────────────────────────────────

/**
 * Skriv dokument-binärinnehåll (PDF/DOCX/.eml …) till lagringen. Skild
 * från entitets-projektionerna (JSON): `document.register` skriver bara
 * metadata, bytes:en skrivs separat. I web-/FSA-flödet sker det
 * klient-sidigt (`uploadDocumentToFsa`) INNAN register; för native-klienter
 * (Office-add-in, #72/ADR 0013) som inte når serverns filsystem skickas
 * bytes:en över tRPC och servern persisterar dem hit i sin git-working-copy.
 */
export interface IContentStore {
  /**
   * Skriv `bytes` till `storagePath` (repo-relativ, t.ex.
   * `documents/content/<id>.eml`). Server-first-runtime:n skriver till sitt
   * content-dir (`FsContentStore`); demo/web är no-op (innehåll skrivs
   * klient-sidigt via FSA).
   */
  write(storagePath: string, bytes: Uint8Array): Promise<void>;

  /**
   * Läs tillbaka `bytes` för `storagePath`, eller `null` om de saknas.
   * Server-side bruk: dokument-klassificerings-jobbet (#518) läser bytes
   * för text-extraktion. Demo/web returnerar `null` (innehållet bor
   * klient-sidigt, inte på servern).
   */
  read(storagePath: string): Promise<Uint8Array | null>;

  /**
   * Finns bytes för `storagePath`? Billig (ingen läsning av innehållet) —
   * byte-synken (#518, ADR 0023) frågar vilka content-adresserade sha:n
   * servern saknar innan klienten laddar upp. Demo/web → `false`.
   */
  exists(storagePath: string): Promise<boolean>;
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
  content: IContentStore;
}

// Buffer-typen exporteras så impl:erna kan importera utan Node:
export type { Buffer };
