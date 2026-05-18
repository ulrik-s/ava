/**
 * `PrismaPasskeyStore` — `IPasskeyStore`-impl mot Prisma.
 *
 * Designval (Single responsibility):
 *   - Storage. Inga ceremony-detaljer. ceremony-helpers ringer in.
 *
 * Designval (Liskov):
 *   - Uppfyller samma kontrakt som in-memory store i tester.
 *
 * Challenge-state: vi använder `unstable_cache`-mönster och persisterar
 * challenges i `Passkey`-tabellen som en kort-livad rad? Nej — istället
 * en separat `PasskeyChallenge`-modell? För enkelhetens skull i denna
 * iteration använder vi en in-memory Map (process-bound). Det skalar
 * inte över multipla Next-instanser, men för demo/Tauri räcker det.
 * När vi kör i prod med flera replicas migrerar vi till Redis.
 */

import type { PrismaClient } from "@prisma/client";
import type { IPasskeyStore, StoredPasskey } from "./passkey-ceremony";

export class PrismaPasskeyStore implements IPasskeyStore {
  // In-memory challenges per process. Bra nog för single-replica;
  // för multi-replica byter vi till Redis senare.
  private challenges: Map<string, string> = new Map();

  constructor(private prisma: PrismaClient) {}

  async saveChallenge(handle: string, challenge: string): Promise<void> {
    this.challenges.set(handle, challenge);
    // Auto-expire efter 5 min — tillräckligt för en bekräftelse-prompt
    setTimeout(() => { this.challenges.delete(handle); }, 5 * 60 * 1000);
  }

  async readChallenge(handle: string): Promise<string | null> {
    return this.challenges.get(handle) ?? null;
  }

  async clearChallenge(handle: string): Promise<void> {
    this.challenges.delete(handle);
  }

  async savePasskey(p: StoredPasskey): Promise<void> {
    await this.prisma.passkey.create({
      data: {
        id: p.id,
        userId: p.userId,
        publicKey: p.publicKey,
        counter: p.counter,
        transports: p.transports,
        name: p.name,
        backedUp: p.backedUp,
        deviceType: p.deviceType,
      },
    });
  }

  async findPasskeyById(id: string): Promise<StoredPasskey | null> {
    const row = await this.prisma.passkey.findUnique({ where: { id } });
    return row ? this.toStored(row) : null;
  }

  async listPasskeysForUser(userId: string): Promise<StoredPasskey[]> {
    const rows = await this.prisma.passkey.findMany({ where: { userId } });
    return rows.map(this.toStored);
  }

  async updateCounter(id: string, counter: bigint): Promise<void> {
    await this.prisma.passkey.update({
      where: { id },
      data: { counter, lastUsedAt: new Date() },
    });
  }

  private toStored = (row: {
    id: string;
    userId: string;
    publicKey: string;
    counter: bigint;
    transports: string[];
    name: string | null;
    backedUp: boolean;
    deviceType: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  }): StoredPasskey => ({
    id: row.id,
    userId: row.userId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: row.transports,
    name: row.name,
    backedUp: row.backedUp,
    deviceType: row.deviceType,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  });
}
