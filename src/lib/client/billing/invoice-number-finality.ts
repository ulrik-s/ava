/**
 * Är fakturans nummer fastställt? (#1243, ADR 0012)
 *
 * I self-hosted sätter SERVERN fakturanumret när fakturan synkas (klientens
 * nummer är preliminärt — räknat ur de fakturor den kände till). Ett dokument
 * som bär numret får därför skapas först när numret är fastställt. I demon
 * (ingen server) är det lokala numret slutgiltigt.
 *
 * `ServerFirstSync`-grenen registrerar en resolver här; utan den (demo) gäller
 * det lokala numret.
 */

/** Numrets läge. */
export type InvoiceNumberState =
  /** Ingen server — det lokala numret gäller (demo). */
  | { state: "local" }
  /** Fastställt av servern (fakturan är synkad). */
  | { state: "final"; invoiceNumber: string | null; ocrReference: string | null }
  /** Inte synkat än — numret kan ändras. */
  | { state: "pending" };

type Resolver = (invoiceId: string) => Promise<InvoiceNumberState>;

// ponytail: en modul-global — det finns exakt en server-synk per flik.
let current: Resolver | null = null;

/** Registrera resolvern (server-first); returnerar avregistreringen. */
export function registerInvoiceNumberResolver(resolver: Resolver): () => void {
  current = resolver;
  return () => { if (current === resolver) current = null; };
}

/** Numrets läge för en faktura. */
export function finalInvoiceNumber(invoiceId: string): Promise<InvoiceNumberState> {
  return current ? current(invoiceId) : Promise.resolve({ state: "local" });
}

/** Fakturans numreringsfält som de läses ur klientstoren. */
export interface InvoiceNumberFields {
  invoiceNumber?: string | null | undefined;
  ocrReference?: string | null | undefined;
}

/** Det resolvern mot klientstoren behöver. */
export interface StoreResolverDeps {
  /** Synka nu (kastar offline — det är ok). */
  flush: () => Promise<void>;
  /** Ligger en ändring för raden kvar i kön? */
  hasPendingFor: (entity: string, id: string) => boolean;
  /** Den lokala raden (kanonisk när inget ligger i kön). */
  readInvoice: (invoiceId: string) => Promise<InvoiceNumberFields | null>;
}

/**
 * Resolver mot self-hosted-klientens store: synka först, och är fakturan
 * då inte längre köad har servern satt numret (och reconcile skrivit in det).
 */
export function storeInvoiceNumberResolver(deps: StoreResolverDeps): Resolver {
  return async (invoiceId) => {
    await deps.flush().catch(() => undefined);
    if (deps.hasPendingFor("invoice", invoiceId)) return { state: "pending" };
    const invoice = await deps.readInvoice(invoiceId);
    if (!invoice) return { state: "pending" };
    return { state: "final", invoiceNumber: invoice.invoiceNumber ?? null, ocrReference: invoice.ocrReference ?? null };
  };
}
