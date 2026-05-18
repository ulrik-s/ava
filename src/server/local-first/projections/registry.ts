/**
 * `ProjectionRegistry` — central mappning mellan entitet-namn,
 * projektion och path-prefix.
 *
 * Två huvudsakliga lookup-mönster:
 *
 *   1. **Write-through** (write→file): tRPC-routern har ett objekt
 *      och vill projicera det till fil.
 *      → `registry.forEntity("matter")` returnerar projektionen.
 *
 *   2. **Hydrate** (file→sqlite): vid pull har vi en path som ändrats
 *      i git och vill ladda om motsvarande rad i SQLite.
 *      → `registry.matchPath("matters/active/abc.json")` ger projektionen
 *      OCH entitet-namnet så vi vet vilken tabell att uppdatera.
 *
 * Designval (SOLID):
 *   - **Open-closed:** ny entitet = `registry.register(...)`. Ingen
 *     ändring av registry-koden.
 *   - **Liskov:** alla `IProjection<T>` får samma behandling oavsett T.
 *     Generisk casting görs via `unknown` istället för `any` så TS-typen
 *     är ärlig.
 *   - **Single responsibility:** registret slår bara upp; det utför inga
 *     skrivningar eller IO självt.
 */

import type { IProjection } from "./base";

export interface RegistryEntry<T = unknown> {
  /** Entity-namn (samma sträng som används i `IDataStore`-delegates). */
  entity: string;
  projection: IProjection<T>;
  /** Returnera `true` om denna projektion äger denna path. */
  ownsPath: (path: string) => boolean;
}

export class ProjectionRegistry {
  private byEntity: Map<string, RegistryEntry<unknown>> = new Map();
  private all: RegistryEntry<unknown>[] = [];

  register<T>(entry: RegistryEntry<T>): void {
    if (this.byEntity.has(entry.entity)) {
      throw new Error(`Projection for entity "${entry.entity}" is already registered`);
    }
    // Vi castar till `unknown` här — det enda säkra sättet att lagra
    // heterogena projektioner i samma karta. Konsumenten castar tillbaka
    // i `forEntity<T>` via generisk-parametern.
    const erased = entry as unknown as RegistryEntry<unknown>;
    this.byEntity.set(entry.entity, erased);
    this.all.push(erased);
  }

  /**
   * Slå upp via entity-namn. Generisk T uttalas vid call-site:
   *
   *   const { projection } = registry.forEntity<Matter>("matter")!;
   */
  forEntity<T>(entity: string): RegistryEntry<T> | null {
    const e = this.byEntity.get(entity);
    if (!e) return null;
    return e as unknown as RegistryEntry<T>;
  }

  /**
   * Matcha en path mot alla projektioner. Returnerar första som svarar
   * "ja" på `ownsPath`. Ordningen är registrerings-ordning — så registrera
   * mer specifika först om de överlappar.
   */
  matchPath(path: string): RegistryEntry<unknown> | null {
    for (const entry of this.all) {
      if (entry.ownsPath(path)) return entry;
    }
    return null;
  }

  entities(): string[] {
    return Array.from(this.byEntity.keys());
  }
}
