/**
 * Tester för `YjsTextField` — den abstraktion som ersätter rå-text-fält
 * (matter.notes, kommentartrådar) med en CRDT som mergas automatiskt
 * när två klienter editerar samtidigt.
 *
 * Designmål:
 *   - Single responsibility: bara CRDT-state + text-rendering. Ingen
 *     filsystem eller git.
 *   - Open-closed: samma klass täcker alla fri-text-fält (matter.notes,
 *     task-comment, document-description, ...).
 *
 * Mest av testerna är CRDT-egenskaper:
 *   1. Round-trip — encode → decode bevarar text
 *   2. Append-only — updates är kumulativa
 *   3. Konflikt-fri merge — två parallella edits → bägge syns
 *   4. Determinism — same updates, same final state
 */

import { describe, it, expect } from "vitest";
import { YjsTextField } from "@/server/local-first/yjs-text-field";

describe("YjsTextField — grundläggande operationer", () => {
  it("nyskapad är tom sträng", () => {
    const f = new YjsTextField();
    expect(f.currentText()).toBe("");
  });

  it("insert vid pos 0 sätter text", () => {
    const f = new YjsTextField();
    f.insert(0, "Hej");
    expect(f.currentText()).toBe("Hej");
  });

  it("insert mitt i texten", () => {
    const f = new YjsTextField();
    f.insert(0, "Hej!");
    f.insert(3, " du");
    expect(f.currentText()).toBe("Hej du!");
  });

  it("delete tar bort interval", () => {
    const f = new YjsTextField();
    f.insert(0, "Hej du där");
    f.delete(3, 3); // tar bort " du"
    expect(f.currentText()).toBe("Hej där");
  });

  it("replaceAll sätter hela texten oavsett vad som fanns innan", () => {
    const f = new YjsTextField();
    f.insert(0, "gammal text");
    f.replaceAll("ny text");
    expect(f.currentText()).toBe("ny text");
  });
});

describe("YjsTextField — encode/decode", () => {
  it("encodedState är base64-sträng", () => {
    const f = new YjsTextField();
    f.insert(0, "test");
    expect(f.encodedState()).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("fromEncodedState rekonstruerar identisk text", () => {
    const f1 = new YjsTextField();
    f1.insert(0, "Vårdnadstvist mot motpart");
    const state = f1.encodedState();

    const f2 = YjsTextField.fromEncodedState(state);
    expect(f2.currentText()).toBe("Vårdnadstvist mot motpart");
  });

  it("encodedState efter flera edits encodar hela historiken", () => {
    const f = new YjsTextField();
    f.insert(0, "första");
    f.insert(6, "andra");
    f.delete(0, 6);
    const restored = YjsTextField.fromEncodedState(f.encodedState());
    expect(restored.currentText()).toBe("andra");
  });

  it("hanterar svenska tecken korrekt över encode/decode", () => {
    const f = new YjsTextField();
    f.insert(0, "Ärendet rör en överenskommelse om åtagande");
    const restored = YjsTextField.fromEncodedState(f.encodedState());
    expect(restored.currentText()).toBe("Ärendet rör en överenskommelse om åtagande");
  });

  it("ger samma state-encode för samma operations-sekvens", () => {
    const f1 = new YjsTextField();
    f1.insert(0, "abc");
    const f2 = new YjsTextField();
    f2.insert(0, "abc");
    // OBS: vi jämför textresultat inte byte-state (Yjs-clientID skiljer)
    expect(f1.currentText()).toBe(f2.currentText());
  });
});

describe("YjsTextField — CRDT-merge av parallella editingar", () => {
  it("två parallella inserts merge:as: bägge syns i texten", () => {
    // Anna börjar med basen
    const anna = new YjsTextField();
    anna.insert(0, "Möte med klient");

    // Björn klonar från Annas state
    const bjorn = YjsTextField.fromEncodedState(anna.encodedState());
    expect(bjorn.currentText()).toBe("Möte med klient");

    // Bägge gör parallella edits
    anna.insert(15, " på fredag"); // → "Möte med klient på fredag"
    bjorn.insert(0, "VIKTIGT: "); // → "VIKTIGT: Möte med klient"

    // Korsa-applicera updates
    const annaUpdate = anna.encodedState();
    const bjornUpdate = bjorn.encodedState();
    anna.applyEncodedUpdate(bjornUpdate);
    bjorn.applyEncodedUpdate(annaUpdate);

    // Bägge ska se samma slutresultat med bägge edits
    expect(anna.currentText()).toBe(bjorn.currentText());
    expect(anna.currentText()).toContain("VIKTIGT:");
    expect(anna.currentText()).toContain("på fredag");
  });

  it("merge är konflikt-fri även när bägge editerar samma position", () => {
    const anna = new YjsTextField();
    anna.insert(0, "AB");
    const bjorn = YjsTextField.fromEncodedState(anna.encodedState());

    anna.insert(1, "X"); // → "AXB"
    bjorn.insert(1, "Y"); // → "AYB"

    anna.applyEncodedUpdate(bjorn.encodedState());
    bjorn.applyEncodedUpdate(anna.encodedState());

    // Yjs väljer en deterministisk ordning baserat på clientID,
    // resultatet är samma för bägge
    expect(anna.currentText()).toBe(bjorn.currentText());
    // Bägge edits syns
    expect(anna.currentText()).toContain("X");
    expect(anna.currentText()).toContain("Y");
  });

  it("applyEncodedUpdate är idempotent — applicera samma update två gånger ger samma state", () => {
    const anna = new YjsTextField();
    anna.insert(0, "Hej");
    const update = anna.encodedState();

    const bjorn = new YjsTextField();
    bjorn.applyEncodedUpdate(update);
    bjorn.applyEncodedUpdate(update); // re-apply
    expect(bjorn.currentText()).toBe("Hej");
  });
});

describe("YjsTextField — robusthet", () => {
  it("fromEncodedState med tom sträng returnerar tom field", () => {
    const f = YjsTextField.fromEncodedState("");
    expect(f.currentText()).toBe("");
  });

  it("kastar inte vid invalid base64 — behandlar som tom", () => {
    const f = YjsTextField.fromEncodedState("not-base64");
    expect(f.currentText()).toBe("");
  });

  it("delete utanför textens längd är ett no-op", () => {
    const f = new YjsTextField();
    f.insert(0, "abc");
    f.delete(10, 5);
    expect(f.currentText()).toBe("abc");
  });
});
