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

  deserialize(raw: string): T {
    return this.schema.parse(JSON.parse(raw));
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
