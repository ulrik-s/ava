import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/server/db";
import { extractText } from "./tika";

/**
 * We talk to a local LLM via any OpenAI-compatible server (Ollama, LM Studio,
 * llama.cpp-server, vLLM, ...). No external API keys needed.
 *
 * Configure via env (nya namn — provider-agnostiska):
 *   LLM_BASE_URL — default "http://localhost:11434" (Ollama)
 *   LLM_MODEL    — default "llama3.1:8b"
 *
 * Bakåtkompat: LM_STUDIO_URL / LM_STUDIO_MODEL respekteras om satta.
 */
const LLM_BASE_URL = (
  process.env.LLM_BASE_URL ?? process.env.LM_STUDIO_URL ?? "http://localhost:11434"
).replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL ?? process.env.LM_STUDIO_MODEL ?? "llama3.1:8b";
// Llama-3-8B-Instruct has ~8K context. System prompt + JSON output eats ~2.5K tokens
// (~10k chars), so cap doc text to leave headroom for output.
const MAX_CHARS = 12_000;

const MATTER_ROLES = [
  "KLIENT", "MOTPART", "MOTPARTSOMBUD", "AKLAGARE",
  "DOMSTOL", "FORSAKRINGSBOLAG", "VITTNE", "OMBUD", "OVRIG",
] as const;
type MatterRole = typeof MATTER_ROLES[number];

const CONTACT_TYPES = [
  "PERSON", "COMPANY", "COURT", "AUTHORITY",
  "INSURANCE_COMPANY", "LAW_FIRM", "OTHER",
] as const;
type ContactType = typeof CONTACT_TYPES[number];

interface PartySuggestion {
  name: string;
  role: MatterRole;
  contactType: ContactType;
  email?: string | null;
  phone?: string | null;
  orgNumber?: string | null;
  personalNumber?: string | null;
  notes?: string | null;
}

interface EventSuggestion {
  title: string;
  description?: string | null;
  eventType?: string | null;
  /** ISO 8601: "2026-05-14" (all-day) or "2026-05-14T09:30:00" (timed) */
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
}

export interface AnalysisResult {
  title: string;
  documentType: string;
  summary: string;
  parties: PartySuggestion[];
  events?: EventSuggestion[];
}

const SYSTEM_PROMPT = `Du är en svensk juristassistent som analyserar dokument som laddas upp i en advokatbyrås ärendehanteringssystem. Din uppgift är att extrahera strukturerad metadata + parter.

Svara ENDAST med giltig JSON enligt schemat:

{
  "title": "kort beskrivande titel, inkl. ev. målnummer/diarienummer",
  "documentType": "Stämningsansökan | Dom | Beslut | Fullmakt | Uppdragsavtal | Avtal | Protokoll | Skrivelse | Bilaga | Polisanmälan | Förundersökning | Överklagande | Yttrande | Annat",
  "summary": "1-3 meningars sammanfattning på svenska",
  "parties": [
    {
      "name": "Fullständigt namn eller firmanamn",
      "role": "KLIENT | MOTPART | MOTPARTSOMBUD | AKLAGARE | DOMSTOL | FORSAKRINGSBOLAG | VITTNE | OMBUD | OVRIG",
      "contactType": "PERSON | COMPANY | COURT | AUTHORITY | INSURANCE_COMPANY | LAW_FIRM | OTHER",
      "email": null,
      "phone": null,
      "orgNumber": null,
      "personalNumber": null,
      "notes": "kort förklaring av hur parten nämns i dokumentet"
    }
  ],
  "events": [
    {
      "title": "t.ex. 'Huvudförhandling' eller 'Svaromål ska inges'",
      "description": "valfri kort kontext",
      "eventType": "Förhandling | Möte | Frist | Dom | Sammanträde | Inlämning | Annat",
      "startAt": "ISO 8601 datum/tid — '2026-05-14' för heldag, '2026-05-14T09:30:00' med tid",
      "endAt": null,
      "allDay": true,
      "location": "t.ex. 'Stockholms tingsrätt, sal 5' eller null"
    }
  ]
}

Regler:
- Lista ENDAST parter/aktörer OCH datum som uttryckligen nämns i dokumentet. Hitta inte på.
- För events: extrahera ALLA framåtriktade eller bindande tidpunkter, t.ex.:
  * Förhandlingsdatum, huvudförhandling, sammanträde (eventType="Förhandling")
  * Möten med klient, motpart, myndighet (eventType="Möte")
  * Frister: svaromål, överklagande, yttrande, inlämning — inkl. FAKTURANS FÖRFALLODAG (eventType="Frist")
  * Dom/beslut som ska meddelas (eventType="Dom")
- Hoppa ENDAST över rent administrativ metadata som "dokumentet skapat", "utskriftsdatum" eller underskriftsdatum utan bindande verkan.
- Om ingen tid anges för en dag, sätt allDay=true och startAt="ÅÅÅÅ-MM-DD".
- Lämna events=[] ENDAST om dokumentet verkligen inte innehåller några tidpunkter.
- Utelämna partier som redan är advokatbyråns egen klient (KLIENT) om oklart — använd OVRIG istället.
- Personnummer: format ÅÅÅÅMMDD-XXXX eller ÅÅMMDD-XXXX. Orgnummer: NNNNNN-NNNN.
- Domstolar → role=DOMSTOL, contactType=COURT.
- Åklagare → role=AKLAGARE, contactType=AUTHORITY.
- Advokatfirmor som företräder motpart → role=MOTPARTSOMBUD, contactType=LAW_FIRM (och lägg ev. enskilda advokater inom firman som separata poster med samma role).
- Försäkringsbolag → role=FORSAKRINGSBOLAG, contactType=INSURANCE_COMPANY.
- Håll ALLA textfält korta: "notes" max 1 mening, "description" max 1 mening, "summary" max 2 meningar. Spara tokens.

MYCKET VIKTIGT: Ditt svar MÅSTE börja med tecknet { och sluta med tecknet }. INGEN text före eller efter. INGA kodblock. INGA förklaringar. INGEN "Here is..." eller "Svar:". BARA JSON.`;

export interface AnalyzeOptions {
  /** Reserved for future flags (kept for backwards compat). */
  skipIfNoApiKey?: boolean;
}

/**
 * Runs full analysis pipeline for a document:
 *   1. Loads file from disk
 *   2. Extracts text via Tika
 *   3. Calls local LLM (OpenAI-compat endpoint) for structured analysis
 *   4. Writes metadata to Document + creates DocumentAnalysisSuggestion rows
 *
 * Non-throwing: errors are written to Document.analysisError.
 */
export async function analyzeDocument(
  documentId: string,
  _opts: AnalyzeOptions = {},
): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return;

  try {
    // 1. Load file
    const absPath = path.isAbsolute(doc.storagePath)
      ? doc.storagePath
      : path.resolve(process.cwd(), doc.storagePath);
    const buffer = await readFile(absPath);

    // 2. Extract text
    let text: string;
    try {
      text = await extractText(buffer, doc.mimeType);
    } catch (e) {
      throw new Error(`Tika-extraktion misslyckades: ${e instanceof Error ? e.message : String(e)}`);
    }
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Ingen text kunde extraheras från dokumentet.");
    }
    const truncated = trimmed.length > MAX_CHARS
      ? trimmed.slice(0, MAX_CHARS) + "\n\n[...avkortad...]"
      : trimmed;

    // 3. Call local LLM (OpenAI-compatible endpoint)
    const endpoint = `${LLM_BASE_URL}/v1/chat/completions`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          max_tokens: 8000,
          // Ask the server to constrain output to valid JSON. Models that don't
          // honor this still tend to produce JSON because the system prompt
          // insists on it; we strip code fences just in case.
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Filnamn: ${doc.fileName}\nMIME: ${doc.mimeType}\n\n--- DOKUMENTTEXT ---\n${truncated}`,
            },
          ],
        }),
      });
    } catch (e) {
      throw new Error(
        `Kunde inte nå LLM-servern på ${LLM_BASE_URL}. Är den igång? (${e instanceof Error ? e.message : String(e)})`,
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM-fel ${response.status}: ${errText.slice(0, 500)}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = body.choices?.[0]?.message?.content?.trim();
    if (!raw) {
      throw new Error("Tomt svar från LLM.");
    }
    const parsed = parseWithRepair(raw);
    if (!parsed) {
      throw new Error(`Kunde inte tolka LLM-svar som JSON. Svar: ${raw.slice(0, 300)}`);
    }

    // 4. Persist
    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: {
          title: truncate(parsed.title, 300),
          documentType: truncate(parsed.documentType, 100),
          summary: truncate(parsed.summary, 2000),
          analyzedAt: new Date(),
          analysisModel: MODEL,
          analysisError: null,
        },
      });

      // Remove previous PENDING suggestions; keep ACCEPTED/REJECTED history.
      await tx.documentAnalysisSuggestion.deleteMany({
        where: { documentId, status: "PENDING" },
      });
      await tx.matterEventSuggestion.deleteMany({
        where: { documentId, status: "PENDING" },
      });

      const events = Array.isArray(parsed.events) ? parsed.events : [];
      for (const ev of events) {
        if (!ev.title || typeof ev.title !== "string") continue;
        if (!ev.startAt || typeof ev.startAt !== "string") continue;
        const parsedStart = parseEventDate(ev.startAt);
        if (!parsedStart) continue;
        const parsedEnd = ev.endAt ? parseEventDate(ev.endAt) : null;
        const allDay = ev.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(ev.startAt.trim());
        await tx.matterEventSuggestion.create({
          data: {
            documentId,
            title: truncate(ev.title, 200) ?? ev.title,
            description: ev.description ? truncate(ev.description, 1000) : null,
            eventType: ev.eventType ? truncate(ev.eventType, 50) : null,
            startAt: parsedStart,
            endAt: parsedEnd,
            allDay,
            location: ev.location ? truncate(ev.location, 300) : null,
            status: "PENDING",
          },
        });
      }

      const parties = Array.isArray(parsed.parties) ? parsed.parties : [];
      for (const p of parties) {
        if (!p.name || typeof p.name !== "string") continue;
        if (!MATTER_ROLES.includes(p.role)) continue;
        if (!CONTACT_TYPES.includes(p.contactType)) continue;
        const name = truncate(p.name, 200);
        if (!name) continue;
        await tx.documentAnalysisSuggestion.create({
          data: {
            documentId,
            name,
            role: p.role,
            contactType: p.contactType,
            email: p.email || null,
            phone: p.phone || null,
            orgNumber: p.orgNumber || null,
            personalNumber: p.personalNumber || null,
            notes: p.notes ? truncate(p.notes, 500) : null,
            status: "PENDING",
          },
        });
      }
    });

    console.log(`[document-analysis] ✓ analyzed ${documentId} (${parsed.parties?.length ?? 0} parties)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[document-analysis] ✗ ${documentId}: ${msg}`);
    await prisma.document.update({
      where: { id: documentId },
      data: { analysisError: truncate(msg, 1000), analyzedAt: new Date() },
    }).catch(() => {});
  }
}

/** Parses an ISO-8601 date/datetime. Returns null on invalid input. */
export function parseEventDate(s: string): Date | null {
  const trimmed = s.trim();
  // Bare date → treat as midnight UTC
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(trimmed + "T00:00:00Z");
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return isNaN(d.getTime()) ? null : d;
}

export function truncate(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Parses LLM output to AnalysisResult, with progressive repair for truncated
 * or corrupted responses from small local models. Returns null only if
 * nothing parseable can be recovered.
 */
export function parseWithRepair(raw: string): AnalysisResult | null {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  // Try perfectly balanced parse first.
  const balanced = findBalancedObject(stripped, start);
  if (balanced) {
    try { return JSON.parse(balanced) as AnalysisResult; } catch { /* fall through */ }
  }

  // Walk character-by-character, recording every position where the JSON
  // "so far" (with open containers closed) parses successfully. Return the
  // result from the furthest successful position.
  const positions = safeCandidatePositions(stripped, start);
  for (let i = positions.length - 1; i >= 0; i--) {
    const candidate = buildClosed(stripped, start, positions[i].end, positions[i].stack);
    try { return JSON.parse(candidate) as AnalysisResult; } catch { /* try earlier */ }
  }
  return null;
}

/**
 * Returns candidate end-positions (at commas or closing-brackets, outside
 * strings) together with the container stack at that point. The LLM output
 * may become corrupt after some point; each candidate represents a prefix
 * we can attempt to close and parse.
 */
function safeCandidatePositions(s: string, start: number): Array<{ end: number; stack: string }> {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;
  const out: Array<{ end: number; stack: string }> = [];

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") { stack.push("{"); continue; }
    if (c === "[") { stack.push("["); continue; }
    if (c === "}" || c === "]") {
      stack.pop();
      out.push({ end: i + 1, stack: stack.join("") });
      if (stack.length === 0) return out;
      continue;
    }
    if (c === ",") {
      out.push({ end: i, stack: stack.join("") });
    }
  }
  return out;
}

function buildClosed(s: string, start: number, end: number, stack: string): string {
  let body = s.slice(start, end).replace(/,\s*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) {
    body += stack[i] === "{" ? "}" : "]";
  }
  return body;
}

/**
 * Extracts the first top-level balanced `{...}` JSON object from a string.
 * Handles prose before/after, code fences, and nested braces. Ignores braces
 * inside strings (respecting escapes). If the output is truncated or corrupted
 * (common with smaller local LLMs), attempts a best-effort repair by trimming
 * to the last valid structural boundary and closing open containers.
 */
export function extractJsonObject(s: string): string | null {
  const stripped = s.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  if (start === -1) return null;

  // Pass 1: look for a perfectly balanced object.
  const balanced = findBalancedObject(stripped, start);
  if (balanced) return balanced;

  // Pass 2: repair. Walk through the body, tracking depth + string state.
  // If we hit corruption (e.g. stray tokens outside strings at depth>0 that
  // aren't valid JSON structural chars), we truncate to the last valid
  // position and close open braces/brackets.
  return repairJson(stripped, start);
}

function findBalancedObject(s: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Best-effort repair for truncated/corrupted JSON from small local LLMs.
 * Tracks the last "safe" position (after a complete key:value pair at a
 * known depth) and closes outstanding containers at that point.
 */
function repairJson(s: string, start: number): string | null {
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escape = false;
  let lastSafe = -1; // position AFTER a comma or opening-brace at current depth

  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === "{") { stack.push("{"); lastSafe = i + 1; continue; }
    if (c === "[") { stack.push("["); lastSafe = i + 1; continue; }
    if (c === "}" || c === "]") {
      stack.pop();
      lastSafe = i + 1;
      if (stack.length === 0) return s.slice(start, i + 1);
      continue;
    }
    if (c === ",") { lastSafe = i; continue; } // truncate right before comma
  }

  if (lastSafe < 0 || stack.length === 0) return null;

  // Truncate to last safe position and close outstanding containers.
  let body = s.slice(start, lastSafe);
  // Strip trailing partial token after last comma (anything since last comma/brace)
  body = body.replace(/,\s*$/, "");
  while (stack.length > 0) {
    const open = stack.pop();
    body += open === "{" ? "}" : "]";
  }
  return body;
}
