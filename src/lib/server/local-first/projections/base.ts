/**
 * `IProjection<T>` — kontraktet för hur en entitet projiceras till en fil
 * i git working tree (per-entity-file-mönstret).
 *
 * Två huvudmönster:
 *   - `IProjection<T>`         — varje entitet är en hel JSON-fil
 *   - `IAppendProjection<T>`   — entitet är en rad i en JSONL-fil
 *
 * Designval (SOLID):
 *   - **Single responsibility:** en projection vet bara om en entitetstyp.
 *   - **Open-closed:** ny entitet = ny `JsonProjection`-subklass, ingen
 *     ändring av befintlig kod.
 *   - **Liskov:** alla projektioner uppfyller samma kontrakt så att
 *     `ProjectionRegistry` kan hantera dem polymorft.
 *   - **Dependency inversion:** klienter (LocalGitStore etc) beror på
 *     interfacet, inte på konkreta klasser.
 *
 * DRY-vinst: Zod-schemat används som BÅDE typkälla och valideringskontrakt
 * vid deserialisering. Subklassen anger schemat en gång och behöver bara
 * implementera `pathFor`.
 */

import type { ZodType } from "zod";

/** Per-entity-file-projektion: hela entiteten är en JSON-fil. */
export interface IProjection<T> {
  /** Stable filesystem path för entiteten, relativt repo-roten. */
  pathFor(input: T): string;
  /** Serialisera till JSON-text. */
  serialize(input: T): string;
  /** Parsa JSON-text → typad entity. Kastar vid schema-fel. */
  deserialize(raw: string): T;
}

/**
 * `IAppendProjection<T>` — entitet är en rad i en JSONL-fil.
 *
 * Används för append-only logs (events, claims, time-entries).
 * Varje rad serialiseras isolerat; deserialize tar en rad i taget.
 */
export interface IAppendProjection<T> {
  /** Path till JSONL-filen där entiteten ska hamna. */
  pathFor(input: T): string;
  /** Serialisera en entitet till en JSONL-rad (utan trailing newline). */
  serializeLine(input: T): string;
  /** Parse en rad. */
  deserializeLine(raw: string): T;
}

/**
 * Basklass som löser serialize/deserialize via Zod. Subklasser
 * implementerar bara `pathFor` — det enda som varierar per entitet.
 */
export abstract class JsonProjection<T> implements IProjection<T> {
  constructor(protected readonly schema: ZodType<T>) {}

  abstract pathFor(input: T): string;

  serialize(input: T): string {
    return JSON.stringify(input, null, 2);
  }

  /**
   * Bevara ALLA fält från JSON:en, även de som inte finns i schemat.
   * Zod default strippar okända fält → UI tappar t.ex. `createdAt`,
   * `fileSize` osv. Vi vill att projection-schemat bara VALIDERAR
   * obligatoriska fält, inte filtrerar bort extra. Här flettas raw-json:en
   * tillbaka över det parsade resultatet så stripping inte sker.
   *
   * Trade-off: typfel i extra-fält fångas inte. Acceptabelt eftersom
   * obligatoriska fält fortfarande typcheckas, och UI-fält är typade i sin
   * egen schemas i src/shared/schemas/.
   */
  protected mergeRawAfterParse(raw: unknown, parsed: T): T {
    if (!raw || typeof raw !== "object" || !parsed || typeof parsed !== "object") return parsed;
    return { ...(raw as Record<string, unknown>), ...(parsed as Record<string, unknown>) } as T;
  }

  deserialize(raw: string): T {
    const json = JSON.parse(raw);
    const parsed = this.schema.parse(json);
    // Behåll extra-fält (createdAt, updatedAt, fileSize, invoiceDate, etc.)
    // som UI/tRPC förväntar sig men som inte är i projection-schemat.
    return this.mergeRawAfterParse(json, parsed);
  }
}

/** Basklass för append-projektioner. Subklasser implementerar `pathFor`. */
export abstract class JsonLinesProjection<T> implements IAppendProjection<T> {
  constructor(protected readonly schema: ZodType<T>) {}

  abstract pathFor(input: T): string;

  serializeLine(input: T): string {
    return JSON.stringify(input);
  }

  deserializeLine(raw: string): T {
    return this.schema.parse(JSON.parse(raw));
  }
}
