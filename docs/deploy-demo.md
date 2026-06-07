# Deploy: demo på GitHub Pages

Demo:n består av en statisk Next.js-export + den rika seed-datan, packad
till en enda site på GitHub Pages. Allt — appens HTML/JS, JSON-entiteterna,
PDF/DOCX-binärer, `manifest.json` — serveras från samma origin. Ingen
extern data-repo, ingen CORS, ingen tredje-parts auth.

## Vad CI gör automatiskt

`.github/workflows/deploy-demo.yml` triggar vid push till `main`:

1. Checkout + Node 24 + `yarn install --immutable`
2. `actions/configure-pages@v5` ger oss `base_path` (t.ex. `/ava`)
3. `bash tooling/scripts/build-demo.sh` med env:
   - `DEMO_BUILD=1` + `NEXT_PUBLIC_DEMO_BUILD=1`
   - `DEMO_BASE_PATH=<base_path>`
   - `NEXT_PUBLIC_DEMO_REPO=<github.repository>` (så app:en hittar data same-origin)
4. Sanity-check: `out/manifest.json` finns + `.nojekyll` finns + ≥30 dokument
5. `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`

## Vad `build-demo.sh` gör

```
1. Stash:a server-only sidor (api/, login/, …)
2. next build (DEMO_BUILD=1) → out/                       (statisk app)
3. tsx tooling/scripts/build-demo-repo.ts --dir out       (rik demo-seed)
   ├─ buildSeed({ orgId: "demo-firma-ab", currentUserId: "u-anna", ... })
   └─ generateDocumentBytes (pdf-lib + html-to-docx)      (40 PDF/DOCX)
4. tsx tooling/scripts/generate-demo-manifest.ts out       (manifest.json)
5. touch out/.nojekyll                                     (gh-pages serverar .ava/-dirs)
6. cleanup-trap restaurerar app-träd
```

Resultat (typiskt):
- 20 HTML-filer (statiska pages)
- 248 JSON-entiteter i manifest
- 40 binärfiler (PDF + DOCX)
- `.nojekyll` så `.ava/users/<email>.json` serveras av Pages

## Manuell körning lokalt

```bash
yarn install
DEMO_BASE_PATH=/ava NEXT_PUBLIC_DEMO_REPO=ulrik-s/ava bash tooling/scripts/build-demo.sh

# Smoke-test:
python3 -m http.server -d out 9000
# → http://localhost:9000/ava/
```

## Bygg + push ett eget demo-repo (utan CI)

```bash
yarn build:demo-repo --dir ./demo-repo
cd ./demo-repo
git init && git add -A && git commit -m "Demo seed"
git remote add origin git@github.com:<owner>/<repo>.git
git push -fu origin main
```

## Vad demon innehåller

| Entitet | Antal |
|---|---|
| Användare | 5 (Anna ADMIN + 4 advokater/biträden) |
| Kontakter | 17 (personer, företag, domstolar, försäkringsbolag) |
| Ärenden | 15 (familjerätt, fastighet, skadestånd, arbetsrätt…) |
| Dokument | 40 binärfiler (20 PDF + 20 DOCX) |
| Avbetalningsplaner | 7 (5 ACTIVE, 1 COMPLETED, 1 CANCELLED) |
| Inbetalningar | 20 |
| Kalender-events | 25 (över alla 5 användare) |
| Tasks | 12 |
| Templates | 5 |

Allt deterministiskt — samma data varje deploy.

## Skillnader mellan demo och self-hosted

| Aspekt | Demo (GH Pages) | Self-hosted (docker) |
|---|---|---|
| Auth | Ingen (read-only-publik) | nginx auth_basic + htpasswd |
| Mutationer | In-memory, försvinner vid reload | Persistas i git via OPFS-write-back |
| LLM | Kan slås på, körs i browsern | Samma |
| Org-id i data | `demo-firma-ab` | `firma-ab` |
| Admin-user | `u-anna` | `current-user` |

Båda använder samma `buildSeed()`-fabrik. Single source of truth.

## Felsökning

**"Inga matters visas i demon"** — kolla `out/manifest.json` att den
listar `matters/active/*.json`-sökvägar. Om manifest är tomt: scan-paths
i `tooling/scripts/generate-demo-manifest.ts` missar någon entitet.

**"PDF/DOCX 404"** — verifiera `out/documents/content/`. Filerna skrivs
av `build-demo-repo.ts` → `generateDocumentBytes()`. Misslyckas vanligen
om `pdf-lib` eller `html-to-docx` saknas (`yarn install`).

**"å/ä/ö renderas konstigt i öppnat dokument"** — `_document-row.tsx`
använder `openDocument()` som taggar `.md`-blobs med `charset=utf-8`.
Binärformat (PDF/DOCX) ska vara opåverkade.

**".ava/ 404 på GH Pages"** — `.nojekyll` saknas i `out/`. CI-builden
har en sanity-check som failedar på det.
