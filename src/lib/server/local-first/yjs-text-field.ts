/**
 * `YjsTextField` — CRDT-baserad text-fält-abstraktion.
 *
 * Ersätter rå-text-fält (matter.notes, kommentartrådar) som behöver
 * konfliktfri merge när två klienter editerar samtidigt.
 *
 * Designval (Single Responsibility):
 *   - Vet bara hur man håller en YDoc med en YText, applicera edits,
 *     encode/decode state. INTE filsystem, INTE git, INTE projektion.
 *
 * Designval (Liskov-substituerbar med ren `string` i läs-kontexter):
 *   - `currentText()` returnerar plain string så consumers som inte bryr
 *     sig om CRDT bara läser textfältet.
 *
 * Yjs-basics:
 *   - YDoc innehåller shared types (här bara en YText)
 *   - Yjs encodar STATE (`encodeStateAsUpdate`) som binär patch
 *   - Två klienter som applicerar varandras encoded state får
 *     deterministiskt samma slutresultat oavsett ordning (CRDT-egenskap)
 *
 * Storage-strategi:
 *   - I matter.json sparas textfältet som base64-string (`notesCrdt`)
 *   - `notes`-fältet hålls i synk för att läs-consumers ska kunna
 *     se text utan att veta om CRDT (men källans sanning är `notesCrdt`)
 */

import * as Y from "yjs";

const TEXT_KEY = "text";

export class YjsTextField {
  private doc: Y.Doc;

  constructor() {
    this.doc = new Y.Doc();
    // Tvinga skapa YText så vi har en stabil referens
    this.doc.getText(TEXT_KEY);
  }

  /**
   * Skapa en field från ett tidigare encodad state (base64-string).
   * Tom eller invalid input returnerar en tom field.
   */
  static fromEncodedState(encoded: string): YjsTextField {
    const field = new YjsTextField();
    if (encoded) field.applyEncodedUpdate(encoded);
    return field;
  }

  /** Aktuell text efter alla tillämpade operationer. */
  currentText(): string {
    return this.doc.getText(TEXT_KEY).toString();
  }

  /** Sätt in text vid position. */
  insert(pos: number, text: string): void {
    this.doc.getText(TEXT_KEY).insert(pos, text);
  }

  /** Radera N tecken från position. No-op om utanför textens längd. */
  delete(pos: number, length: number): void {
    const text = this.doc.getText(TEXT_KEY);
    const safeLength = Math.max(0, Math.min(length, text.length - pos));
    if (safeLength <= 0 || pos >= text.length) return;
    text.delete(pos, safeLength);
  }

  /** Ersätt hela texten med ny string (delete + insert). */
  replaceAll(newText: string): void {
    const text = this.doc.getText(TEXT_KEY);
    text.delete(0, text.length);
    text.insert(0, newText);
  }

  /** Encoda nuvarande state som base64-sträng för persistence. */
  encodedState(): string {
    return toBase64(Y.encodeStateAsUpdate(this.doc));
  }

  /**
   * Applicera ett encodad state-update från en peer. Idempotent —
   * applicera samma update flera gånger ger samma slutresultat.
   * Invalid base64 sväljs tyst (behandlas som no-op).
   */
  applyEncodedUpdate(encoded: string): void {
    if (!encoded) return;
    try {
      const bytes = fromBase64(encoded);
      Y.applyUpdate(this.doc, bytes);
    } catch {
      // Invalid base64 eller corrupt update — fortsätt utan att krascha
    }
  }
}

// ── base64-helpers (DRY: en gång, används av encode + decode) ─────

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(s: string): Uint8Array {
  // Buffer.from är tolerant — invalid karaktärer returnerar tom buffer
  // som Y.applyUpdate sedan kastar på. Vi fångar i applyEncodedUpdate.
  return new Uint8Array(Buffer.from(s, "base64"));
}
