/**
 * Server-only ports. Routrar importerar bara INTERFACES härifrån —
 * inga konkreta implementationer. Composition root (createContext för
 * server, DemoBootstrap för demo) wirar konkret implementation.
 */

import type { Buffer } from "node:buffer";
import type { DocumentId, UserId } from "@/lib/shared/schemas/ids";

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
  analyze(documentId: DocumentId): Promise<void>;
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

// ─── LeaseStore (ADR 0033 §2 — mjuk lease) ─────────────────────────

/**
 * En aktiv (eller nyss utgången) lease på ett dokument — den mjuka
 * check-out:en som förebygger konflikter (ADR 0033 §2). `holderName`
 * denormaliseras för UI:t ("Anna redigerar"). Tider i ms sedan epoch.
 */
export interface LeaseView {
  documentId: DocumentId;
  holderId: UserId;
  holderName: string;
  acquiredAt: number;
  lastHeartbeatAt: number;
  /** `now − lastHeartbeatAt ≥ stale-tröskeln` → "verkar inte redigera längre" (ta-över-bar). */
  stale: boolean;
}

/** Utfall av {@link ILeaseStore.acquire}. */
export interface AcquireLeaseResult {
  /** Fick/håller anroparen leasen? `false` = någon ANNAN håller en levande lease. */
  acquired: boolean;
  /** Aktuell lease: anroparens (om `acquired`), annars den andra hållarens. */
  lease: LeaseView;
}

/**
 * Mjuk lease-store (ADR 0033 §2). In-memory på den tunna servern — leases
 * är efemär online-koordinering, inte durabel domändata; en omstart =
 * alla heartbeats slutar = alla leases löper ut (korrekt semantik).
 */
export interface ILeaseStore {
  /** Ta leasen om fri/utgången/redan din (själv-återtagande); annars rapportera annan hållare. */
  acquire(documentId: DocumentId, holderId: UserId, holderName: string): AcquireLeaseResult;
  /** Heartbeat: förnya din lease. `false` = du håller den inte längre (utgången/övertagen). */
  renew(documentId: DocumentId, holderId: UserId): boolean;
  /** Släpp din lease (idempotent; no-op om du inte håller den). */
  release(documentId: DocumentId, holderId: UserId): void;
  /** Permanent omtilldelning till anroparen (ta-över ett stale/dött lås). */
  takeover(documentId: DocumentId, holderId: UserId, holderName: string): LeaseView;
  /** Aktuell lease, eller `null` om fri/utgången. */
  get(documentId: DocumentId): LeaseView | null;
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
  lease: ILeaseStore;
}

// Buffer-typen exporteras så impl:erna kan importera utan Node:
export type { Buffer };
