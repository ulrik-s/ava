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
 * FSA (`uploadDocumentToFsa`), aldrig server-sidigt — så detta är en tyst
 * no-op (konsistent med demo:ns read-only-semantik). Server-runtime:n
 * (git-peer) ersätter denna med en skrivande impl (`NodeContentStore`).
 */
export const noopContentStore: IContentStore = {
  async write() { /* no-op */ },
};

export const noopPorts: IPorts = {
  email: noopEmail,
  documentAnalyzer: noopDocumentAnalyzer,
  searchIndex: noopSearchIndex,
  paymentScanner: noopPaymentScanner,
  content: noopContentStore,
};
