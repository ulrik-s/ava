# Dokument-textextraktion + sökning

## Problem

Dokument-binärfiler (.pdf, .docx) är osökbara som-är. Vi måste extrahera
text och göra den persistent + sökbar. Och eftersom användaren raderar
ärenden och dokument måste lagringen vara **delete-vänlig från ett
git-perspektiv** — varje document-state ska gå att tömma utan att lämna
spår eller fragmentera index-filen.

## Lagringslayout (valt)

```
documents/
  <id>.json                ← metadata (befintlig)
  content/
    <id>.<ext>             ← binärfil: PDF/DOCX/etc (befintlig)
  text/
    <id>.txt               ← extraherad ren text (NY)
```

**Motivering:**

1. **Ett-fil-per-dokument** = ett radera-kommando per doc. Inget shared
   index-fil som rivs om varje delete.
2. **Plain text** = git komprimerar och delta:ar effektivt mellan
   commits. Diff:en blir läsbar i pull-requests / git log.
3. **Parallell till `content/`** = symmetrisk struktur som är lätt att
   förstå och backuppa.
4. **Samma id som metadata** = trivialt att hitta tillsammans, atomiskt
   delete via `rm documents/{<id>.json,content/<id>.*,text/<id>.txt}`.

### Alternativ vi avvisade

| Alt | Varför vi inte valde |
|---|---|
| `documents/.search-index.json` (en stor fil) | Varje delete = git churn på hela filen. Slö merge-konflikter. |
| `matters/<id>/document-texts/...` | Lokalitet bra, men flyttar man dokument mellan ärenden måste filen flyttas också. Mer komplext. |
| Binärt inverted-index (Lunr/MiniSearch i fil) | Inte human-readable, svår merge, tappar git:s delta-styrka. |
| `text/<id>.md` (markdown med metadata) | Vinsten är liten över .txt. Vi behåller .txt för enkelhet. |

## Extraktion

Två separata libs, fungerar i browser:

| Format | Lib | Storlek |
|---|---|---|
| PDF  | `pdfjs-dist` (Mozillas pdf.js) | ~3 MB gzipped, men cache:as |
| DOCX | `mammoth` (.docx → text)        | ~250 KB |
| TXT/MD | Inget (läs som text)         | — |
| Andra | Skipa (loggar warning)         | — |

Extraktion sker **vid upload-tid** i browser:n. Sparas i FSA + commit:as
i nästa sync. Workers körs via jobb-kön (`extract-text`-kind).

## Search

`document-content-cache` läser nu **två källor** för varje doc:
1. `documents/content/<id>.<ext>` om det är plain text (`.md`/`.txt`)
2. `documents/text/<id>.txt` (extraherad text från binärer)

Båda fyller samma cache-key (doc-id). Search-funktionen är oförändrad —
matchar mot cache:n.

## Delete-flöde

När man tar bort ett dokument:
1. `documents/<id>.json` → unlink
2. `documents/content/<id>.<ext>` → unlink  
3. `documents/text/<id>.txt` → unlink (nytt steg)
4. Också ta bort från sökcache: `clearDocumentContent(id)`

Detsamma vid radera ärende:
1. För varje doc i ärendet: kör delete-flödet
2. Sen `matters/<id>.json` → unlink

## Performance

- **Upload latency**: PDF-extraktion lägger 1-5s per dokument (i bakgrund
  via jobb-kö, blockar inte UI)
- **Search latency**: oförändrad, allt redan i memory-cache
- **Storage cost**: ~10% av PDF-storlek för plain text. Git komprimerar
  ytterligare. För 1000 dokument à 20kB text → 20 MB → ~5 MB efter
  git-packning
- **Cold start**: cache:n preloadas vid app-start parallellt. För 100
  dokument à ~5-50kB text: ~2-5s totalt över snabbt nätverk

## Implementations-checklista

- [ ] Lägga till `pdfjs-dist` + `mammoth` som deps
- [ ] `src/client/lib/text-extraction/extract.ts` — pure function `extractText(blob, mime) → string`
- [ ] Worker: `extract-text`-job i jobQueue som körs vid upload
- [ ] writeBack: hantera "documentText"-entity som skriver text-filen
- [ ] tRPC: ny mutation `document.writeExtractedText`
- [ ] Upload-flow: enqueue extract-job efter classify
- [ ] Delete-flow: ta bort text-fil också
- [ ] content-cache: läs från `documents/text/<id>.txt` också
- [ ] demo-manifest-generator: inkludera text-filer
- [ ] Tester (TDD) per modul
