/**
 * Regel-loader: läser regler från DB (server-läget) eller filsystem
 * (framtida local-first-läget) och returnerar validerade `AvaRule`-objekt.
 *
 * Filtrerar bara på org-id; matchning på trigger görs i `match.ts`.
 */

import type { PrismaClient } from "@prisma/client";
import { avaRuleSchema, type AvaRule } from "./schema";

export interface IRuleLoader {
  /** Alla aktiverade regler för byrån. */
  loadEnabled(): Promise<AvaRule[]>;

  /** Hämta en regel via ID. */
  loadById(id: string): Promise<AvaRule | null>;
}

export class PostgresRuleLoader implements IRuleLoader {
  constructor(private prisma: PrismaClient, private organizationId: string) {}

  async loadEnabled(): Promise<AvaRule[]> {
    const rows = await this.prisma.avaRule.findMany({
      where: { organizationId: this.organizationId, enabled: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.flatMap((row) => {
      try {
        return [avaRuleSchema.parse(row.body)];
      } catch (err) {
        console.error(`[rules] regel ${row.id} parsade inte: ${err}`);
        return [];
      }
    });
  }

  async loadById(id: string): Promise<AvaRule | null> {
    const row = await this.prisma.avaRule.findFirst({
      where: { id, organizationId: this.organizationId },
    });
    if (!row) return null;
    try { return avaRuleSchema.parse(row.body); } catch { return null; }
  }
}
