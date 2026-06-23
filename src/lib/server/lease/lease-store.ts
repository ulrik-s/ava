/**
 * `InMemoryLeaseStore` (ADR 0033 §2) — den mjuka leasen (osynligt check-out)
 * som förebygger redigerings-konflikter på dokument.
 *
 * In-memory på den tunna servern med flit: en lease är efemär online-
 * koordinering, inte durabel domändata. En server-omstart = alla helpers
 * slutar heartbeata = alla leases löper ut — exakt samma utfall som om alla
 * stängde sina dokument. Inget att persistera. (Takhöjd: en multi-instans-
 * server skulle behöva delad store (Redis/tabell) — då byts denna adapter ut.)
 *
 * Tre trösklar (ADR 0033, "Öppna frågor"):
 *   - heartbeat ~30 s: klienten förnyar (sköts klient-sidigt, steg 4).
 *   - STALE ~2 min utan heartbeat: leasen visas som "verkar inte redigera
 *     längre" → en annan användare erbjuds "Ta över".
 *   - EXPIRE ~5 min utan heartbeat: leasen finns inte längre → dokumentet är
 *     fritt att ta utan ta-över.
 *
 * `now` injiceras → deterministiska tester utan riktig tid.
 */

import type { DocumentId, UserId } from "@/lib/shared/schemas/ids";
import type { AcquireLeaseResult, ILeaseStore, LeaseView } from "../ports";

export const LEASE_STALE_MS = 2 * 60_000;
export const LEASE_EXPIRE_MS = 5 * 60_000;

/** Lagrad lease (utan det härledda `stale`-fältet). */
type StoredLease = Omit<LeaseView, "stale">;

export class InMemoryLeaseStore implements ILeaseStore {
  private readonly leases = new Map<string, StoredLease>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  acquire(documentId: DocumentId, holderId: UserId, holderName: string): AcquireLeaseResult {
    const current = this.live(documentId);
    // Fri, utgången, eller redan din (själv-återtagande) → ta/förnya leasen.
    if (!current || current.holderId === holderId) {
      const lease: StoredLease = {
        documentId,
        holderId,
        holderName,
        acquiredAt: current?.holderId === holderId ? current.acquiredAt : this.now(),
        lastHeartbeatAt: this.now(),
      };
      this.leases.set(documentId, lease);
      return { acquired: true, lease: this.view(lease) };
    }
    // Levande lease hos någon annan → skrivskyddat (UI:t styr dit, steg 4/5).
    return { acquired: false, lease: this.view(current) };
  }

  renew(documentId: DocumentId, holderId: UserId): boolean {
    const current = this.live(documentId);
    if (!current || current.holderId !== holderId) return false;
    current.lastHeartbeatAt = this.now();
    return true;
  }

  release(documentId: DocumentId, holderId: UserId): void {
    const current = this.leases.get(documentId);
    if (current && current.holderId === holderId) this.leases.delete(documentId);
  }

  takeover(documentId: DocumentId, holderId: UserId, holderName: string): LeaseView {
    const lease: StoredLease = { documentId, holderId, holderName, acquiredAt: this.now(), lastHeartbeatAt: this.now() };
    this.leases.set(documentId, lease);
    return this.view(lease);
  }

  get(documentId: DocumentId): LeaseView | null {
    const current = this.live(documentId);
    return current ? this.view(current) : null;
  }

  /** Aktuell lease om den inte löpt ut; rensar och returnerar null annars. */
  private live(documentId: DocumentId): StoredLease | null {
    const lease = this.leases.get(documentId);
    if (!lease) return null;
    if (this.now() - lease.lastHeartbeatAt >= LEASE_EXPIRE_MS) {
      this.leases.delete(documentId);
      return null;
    }
    return lease;
  }

  private view(lease: StoredLease): LeaseView {
    return { ...lease, stale: this.now() - lease.lastHeartbeatAt >= LEASE_STALE_MS };
  }
}
