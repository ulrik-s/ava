# ADR 0040 — Kalendern är ett API utan egen vy; frister är uppgifter

**Status:** Antagen · **Datum:** 2026-11-26 · **Issue:** #2178
**Bygger på:** [ADR 0035](0035-ava-cli-och-mcp-over-approuter.md) · **Berör:** `calendar`-routern, `calendar_events`, frister

## Kontext

Kalenderns vy togs bort i #1629. Data, router och schema lämnades kvar. Sedan dess har
kalendern levt halvvägs:

- `calendar`-routern ändras fortfarande (#2150), och dess enda användare är
  AVA-CLI:t och MCP-servern (`tooling/ava-cli`, ADR 0035). Via dem bokar Claude möten
  och förhandlingar åt juristerna.
- Frister finns på två sätt: som kalenderhändelser (`kind: "deadline"`) och som uppgifter
  med `dueAt`. Frister som kalenderhändelser syns ingenstans (ava-feedback#134), och
  arbetsordrarna #2120 och #2121 flyttar dem till uppgifter.

Kvalitetsgenomgången 2026-11-26 tog upp det här som en halvavvecklad mekanism: det
saknades ett beslut om vad kalendern är.

## Beslut

1. **Kalendern behålls som ett API för tidsbokningar** (möten, förhandlingar, förhör):
   `calendar`-routern och `calendar_events`. Den har ingen egen vy i appen.
   Tidsbokningarna når juristerna via MCP och CLI, och via Outlook när synken mot
   Graph-kalendern byggs.
2. **Frister är uppgifter.** En frist har ett datum men ingen tid och ska bockas av. Den
   lever som en uppgift med `dueAt` (Frister, Att åtgärda, ärendets frister).
3. **`kind: "deadline"` avvecklas** i expand/contract-ordning:
   - **expand:** #2120 och #2121 ser till att inga nya frister skapas som
     kalenderhändelser, och flyttar de befintliga till uppgifter.
   - **contract:** `"deadline"` tas bort ur `calendarEventKindSchema` och ur databasen.
     **Slutdatum: 2027-01-31.**
4. Kalendern får en vy igen bara genom ett nytt beslut. Det kräver en ny ADR som ersätter
   den här.

## Konsekvenser

- Ändringar i `calendar`-routern granskas mot CLI:ts och MCP:ns verktygsbeskrivningar
  (`tooling/ava-cli/tool-descriptions.ts`), eftersom det är de som används.
- Ingen UI-kod får läsa `calendar_events` utan en ny ADR.
- Övergångsvägarna har var sitt issue med slutdatum: `kind: "deadline"` (contract-steget
  ovan), `document_type`/`tags` (ADR 0038 §6), de pensionerade `-v2`-köerna
  (`RETIRED_JOB_QUEUES`) och git-vägen (ADR 0002 och 0005, ersatta av ADR 0016).
