/**
 * `schema-version` — datamodellens version + versionsgrinden (ADR 0004).
 * Testen lockar fast grindens fyra fall och den defensiva parsningen.
 */
import { describe, it, expect } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  IncompatibleSchemaVersionError,
  assertRepoSchemaCompatible,
  parseSchemaVersion,
} from "@/lib/shared/schema-version";

describe("parseSchemaVersion", () => {
  it("accepterar positiva heltal", () => {
    expect(parseSchemaVersion(1)).toBe(1);
    expect(parseSchemaVersion(7)).toBe(7);
  });

  it("avvisar saknat/ogiltigt → undefined", () => {
    expect(parseSchemaVersion(undefined)).toBeUndefined();
    expect(parseSchemaVersion(null)).toBeUndefined();
    expect(parseSchemaVersion("1")).toBeUndefined();
    expect(parseSchemaVersion(0)).toBeUndefined();
    expect(parseSchemaVersion(-3)).toBeUndefined();
    expect(parseSchemaVersion(1.5)).toBeUndefined();
    expect(parseSchemaVersion(NaN)).toBeUndefined();
  });
});

describe("assertRepoSchemaCompatible", () => {
  it("OK när repo == kod", () => {
    expect(() => assertRepoSchemaCompatible(2, 2)).not.toThrow();
  });

  it("OK när repo < kod (migrate-on-read i senare fas)", () => {
    expect(() => assertRepoSchemaCompatible(1, 3)).not.toThrow();
  });

  it("OK när version saknas → tolkas som v1-baslinje", () => {
    expect(() => assertRepoSchemaCompatible(undefined, 1)).not.toThrow();
    expect(() => assertRepoSchemaCompatible(undefined, 5)).not.toThrow();
  });

  it("VÄGRAR när repo > kod (skydd mot tyst datakorruption)", () => {
    expect(() => assertRepoSchemaCompatible(2, 1)).toThrow(IncompatibleSchemaVersionError);
    expect(() => assertRepoSchemaCompatible(2, 1)).toThrow(/nyare AVA-version/);
  });

  it("felet bär både repo- och kod-version", () => {
    try {
      assertRepoSchemaCompatible(9, 4);
      expect.unreachable("skulle ha kastat");
    } catch (err) {
      expect(err).toBeInstanceOf(IncompatibleSchemaVersionError);
      expect((err as IncompatibleSchemaVersionError).repoVersion).toBe(9);
      expect((err as IncompatibleSchemaVersionError).codeVersion).toBe(4);
    }
  });

  it("default codeVersion = CURRENT_SCHEMA_VERSION", () => {
    expect(() => assertRepoSchemaCompatible(CURRENT_SCHEMA_VERSION)).not.toThrow();
    expect(() => assertRepoSchemaCompatible(CURRENT_SCHEMA_VERSION + 1)).toThrow(
      IncompatibleSchemaVersionError,
    );
  });
});
