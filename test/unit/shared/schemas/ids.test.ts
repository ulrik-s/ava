/**
 * Branded (nominal) id-typer — [[ids]].
 *
 * Två slags assertions här:
 *   1. Runtime (vitest) — bevisar att `.brand()` INTE ändrar runtime-värdet
 *      eller valideringen (samma som en vanlig `z.string().min(1)`).
 *   2. Typ-nivå (`@ts-expect-error`) — bevisar att brands är nominellt
 *      distinkta. Dessa rader körs harmlöst men deras VÄRDE ligger i att
 *      `bun run typecheck` (include: **\/*.ts) verifierar att felen finns där
 *      de ska. Tas en brand bort → typecheck blir rött.
 */

import { describe, it, expect } from "vitest-compat";
import { matterSchema, matterContactSchema } from "@/lib/shared/schemas";
import {
  matterIdSchema,
  contactIdSchema,
  asId,
  type MatterId,
  type ContactId,
} from "@/lib/shared/schemas/ids";

const now = "2026-05-24T10:00:00Z";

describe("branded id-schema (runtime)", () => {
  it("parsar en icke-tom sträng och bevarar värdet oförändrat", () => {
    const id = matterIdSchema.parse("m-1");
    expect(id).toBe("m-1");
    expect(typeof id).toBe("string");
  });

  it("behåller min(1) — tom sträng avvisas", () => {
    expect(() => matterIdSchema.parse("")).toThrow();
    expect(() => contactIdSchema.parse("")).toThrow();
  });

  it("entity-schemat brandar id/FK-fält men runtime-värdet är en vanlig sträng", () => {
    const m = matterSchema.parse({
      id: "m-1",
      organizationId: "o-1",
      matterNumber: "2026-0001",
      title: "T",
      createdAt: now,
      updatedAt: now,
    });
    expect(m.id).toBe("m-1");
    expect(m.organizationId).toBe("o-1");
  });

  it("matterContact brandar matterId och contactId var för sig", () => {
    const mc = matterContactSchema.parse({
      id: "mc-1",
      matterId: "m-1",
      contactId: "c-1",
      role: "KLIENT",
      createdAt: now,
    });
    expect(mc.matterId).toBe("m-1");
    expect(mc.contactId).toBe("c-1");
  });

  it("asId castar en betrodd sträng utan validering", () => {
    expect(asId<"MatterId">("m-1")).toBe("m-1");
  });
});

describe("branded id-typer (typ-nivå — verifieras av tsc)", () => {
  it("är nominellt distinkta och en subtyp av string", () => {
    const matterId: MatterId = asId<"MatterId">("m-1");
    const contactId: ContactId = asId<"ContactId">("c-1");

    // Tillåtet: en MatterId ÄR en string.
    const asString: string = matterId;
    expect(asString).toBe("m-1");

    // @ts-expect-error — rå string får inte tilldelas MatterId utan parse/cast.
    const fromRaw: MatterId = "m-1";

    // @ts-expect-error — ContactId får inte tilldelas en MatterId-variabel.
    const mixed: MatterId = contactId;

    // @ts-expect-error — MatterId får inte tilldelas en ContactId-variabel.
    const mixed2: ContactId = matterId;

    // Runtime: värdena är oförändrade strängar (assertions för att "använda"
    // de @ts-expect-error-bundna variablerna så lint inte klagar).
    expect([fromRaw, mixed, mixed2]).toEqual(["m-1", "c-1", "m-1"]);
  });
});
