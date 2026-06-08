/**
 * Tester för matter-projektion utökad med Yjs-CRDT-fält (notes).
 *
 * Matter-schemat har två fält som hänger ihop:
 *   - notes      (string)       — renderad text för läs-vyer
 *   - notesCrdt  (string|null)  — base64 av YDoc-state, källans sanning
 *
 * Projektion bevarar BÅDA i JSON. När notesCrdt finns ska consumers
 * som vill editera räkna ut texten från CRDT — annars är notes en
 * giltig fallback (för t.ex. nya ärenden utan CRDT-historik).
 */

import { describe, it, expect } from "vitest-compat";
import { matterProjectionSchema, MatterProjection } from "@/lib/server/local-first/projections/matter";
import { YjsTextField } from "@/lib/server/local-first/yjs-text-field";

describe("MatterProjection — med CRDT-notes-fält", () => {
  const proj = new MatterProjection();

  it("accepterar notes-fält som plain string (bakåtkompatibelt)", () => {
    const data = matterProjectionSchema.parse({
      id: "m1",
      matterNumber: "2026-0001",
      title: "T",
      status: "ACTIVE",
      organizationId: "org-1",
      notes: "Anteckningar",
    });
    expect(data.notes).toBe("Anteckningar");
  });

  it("accepterar notesCrdt som base64-string", () => {
    const field = new YjsTextField();
    field.insert(0, "Mötesanteckningar");
    const data = matterProjectionSchema.parse({
      id: "m1",
      matterNumber: "2026-0001",
      title: "T",
      status: "ACTIVE",
      organizationId: "org-1",
      notes: "Mötesanteckningar",
      notesCrdt: field.encodedState(),
    });
    expect(data.notesCrdt).toBe(field.encodedState());
  });

  it("notes och notesCrdt är optional (för minimal matter)", () => {
    const data = matterProjectionSchema.parse({
      id: "m1",
      matterNumber: "2026-0001",
      title: "T",
      status: "ACTIVE",
      organizationId: "org-1",
    });
    expect(data.notes).toBeUndefined();
    expect(data.notesCrdt).toBeUndefined();
  });

  it("round-trip serialize bevarar CRDT-state", () => {
    const field = new YjsTextField();
    field.insert(0, "Anteckning från fredag");
    const matter = {
      id: "m1",
      matterNumber: "2026-0001",
      title: "Vårdnadstvist",
      status: "ACTIVE" as const,
      organizationId: "org-1",
      notes: field.currentText(),
      notesCrdt: field.encodedState(),
    };
    const text = proj.serialize(matter);
    const restored = proj.deserialize(text);
    expect(restored.notes).toBe("Anteckning från fredag");

    // Texten ska gå att rekonstruera från CRDT-state
    const restoredField = YjsTextField.fromEncodedState(restored.notesCrdt!);
    expect(restoredField.currentText()).toBe("Anteckning från fredag");
  });
});

describe("YjsTextField mot matter-flödet — full kollaborativ scenario", () => {
  it("Anna + Björn editerar samma matter-anteckning parallellt → bägge edits syns", () => {
    // 1. Anna skapar matter med initial notes
    const baseField = new YjsTextField();
    baseField.insert(0, "Möte med klient ");
    const baseMatter = {
      id: "m1",
      matterNumber: "2026-0001",
      title: "T",
      status: "ACTIVE" as const,
      organizationId: "org-1",
      notes: baseField.currentText(),
      notesCrdt: baseField.encodedState(),
    };

    // 2. Björn klonar — laddar matter:n från JSON
    const annaField = YjsTextField.fromEncodedState(baseMatter.notesCrdt!);
    const bjornField = YjsTextField.fromEncodedState(baseMatter.notesCrdt!);

    // 3. Bägge editerar parallellt
    annaField.insert(annaField.currentText().length, "på fredag");
    bjornField.insert(0, "VIKTIGT: ");

    // 4. Korsa-applicera (motsvarar git merge)
    annaField.applyEncodedUpdate(bjornField.encodedState());
    bjornField.applyEncodedUpdate(annaField.encodedState());

    // 5. Bägge ska se samma slutresultat
    expect(annaField.currentText()).toBe(bjornField.currentText());
    expect(annaField.currentText()).toContain("VIKTIGT:");
    expect(annaField.currentText()).toContain("på fredag");
  });
});
