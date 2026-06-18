/**
 * No-op ports för demo-läget. Read-only — mutations syns aldrig på
 * server-sidan ändå, så side-effects kan tystas helt.
 */

import type {
  IEmailSender,
  IDocumentAnalyzer,
  ISearchIndex,
  IPaymentScanner,
  IContentStore,
  IPorts,
} from "../ports";

export const noopEmail: IEmailSender = {
  async send() { /* no-op */ },
};

export const noopDocumentAnalyzer: IDocumentAnalyzer = {
  async analyze() { /* no-op */ },
};

export const noopSearchIndex: ISearchIndex = {
  async search() {
    return { hits: [], estimatedTotalHits: 0 };
  },
  async upsert() { /* no-op */ },
  async remove() { /* no-op */ },
};

export const noopPaymentScanner: IPaymentScanner = {
  async scan() { /* no-op */ },
};

/**
 * No-op content-store: i demo/web skrivs dokument-bytes klient-sidigt via
 * FSA (`uploadDocumentToFsa`), aldrig server-sidigt — så write är en tyst
 * no-op och read ger `null` (inget innehåll bor på servern). Server-first-
 * runtime:n ersätter denna med `FsContentStore`.
 */
export const noopContentStore: IContentStore = {
  async write() { /* no-op */ },
  async read() { return null; },
  async exists() { return false; },
};

export const noopPorts: IPorts = {
  email: noopEmail,
  documentAnalyzer: noopDocumentAnalyzer,
  searchIndex: noopSearchIndex,
  paymentScanner: noopPaymentScanner,
  content: noopContentStore,
};
