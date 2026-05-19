# Deploya demo till GitHub Pages

Den här guiden beskriver hur du publicerar AVA-demon (`/demo`-rutten) som
en statisk site på GitHub Pages, med demo-datan hostad på en **annan**
GitHub Pages-instans. Inga externa beroenden — bara GitHub.

## Arkitektur

```
                ┌──────────────────────────────────┐
                │   GitHub Pages (UI)              │
                │   https://you.github.io/ava/     │
                │                                  │
                │   - /demo  (UI)                  │
                │   - Service Worker (PWA)         │
                │   - WebLLM (opt-in, 700 MB)      │
                └─────────────┬────────────────────┘
                              │ fetch JSON-filer
                              │ Access-Control-Allow-Origin: *
                              ▼
                ┌──────────────────────────────────┐
                │   GitHub Pages (data)            │
                │   https://you.github.io/ava-demo │
                │                                  │
                │   - manifest.json                │
                │   - matters/active/*.json        │
                │   - contacts/*.json              │
                └──────────────────────────────────┘
```

GitHub Pages serverar publika filer med `Access-Control-Allow-Origin: *`
automatiskt — ingen CORS-proxy behövs. Detta är GitHub:s
officiella mönster för "ge en browser läsåtkomst till filer i ett
publikt repo".

## Steg 1 — Förbered demo-data-repo:t

I ditt **demo-data-repo** (t.ex. `ulrik-s/ava-demo`):

1. Strukturera filerna under standardprefix:en (`matters/active/`,
   `contacts/`, `.ava/users/`).
2. Generera `manifest.json` (lista över alla JSON-filer som loadern
   ska hämta):

   ```bash
   yarn tsx ../ava/scripts/generate-demo-manifest.ts .
   ```

   Eller automatisera via en GitHub Action — se "Auto-generera
   manifest" nedan.

3. Aktivera GitHub Pages: **Settings → Pages → Source: Deploy from
   a branch → main / (root)**.

Demo-datan blir nu tillgänglig på `https://<user>.github.io/<demo-repo>/`.

### Auto-generera manifest (rekommenderas)

Lägg `.github/workflows/manifest.yml` i demo-data-repo:t:

```yaml
name: Update manifest
on:
  push:
    branches: [main]
    paths-ignore: [manifest.json]
permissions:
  contents: write
jobs:
  manifest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: |
          curl -fsSL https://raw.githubusercontent.com/<user>/ava/main/scripts/generate-demo-manifest.ts -o /tmp/gen.ts
          npx -y tsx /tmp/gen.ts .
      - run: |
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git add manifest.json
          git diff --staged --quiet || git commit -m "Auto-update manifest"
          git push
```

Då uppdateras manifestet automatiskt vid varje commit till `main`.

## Steg 2 — Konfigurera UI-repo:t

I ditt **UI-repo** (`ulrik-s/ava`):

1. **Settings → Pages → Source**: välj **GitHub Actions**.
2. Inga secrets behövs.

## Steg 3 — Pusha till `main`

Workflow:n `.github/workflows/deploy-demo.yml` triggas av varje push
till `main` och kör:

```
yarn install --immutable
yarn prisma generate
bash scripts/build-demo.sh    # DEMO_BUILD=1 next build → out/
actions/upload-pages-artifact
actions/deploy-pages
```

När den är klar (typiskt 2–4 min) får du en URL som
`https://<user>.github.io/<repo>/demo/`.

Användaren klistrar in sin demo-data-repo (t.ex.
`https://github.com/<user>/ava-demo` eller kortformen `<user>/ava-demo`)
och loadern auto-mappar till motsvarande GH Pages-URL.

## Lokal verifiering före deploy

Bygg och servera lokalt för att sanity-checka:

```bash
bash scripts/build-demo.sh
cd out
python3 -m http.server 8765
# → http://localhost:8765/demo/
```

Notera: i `_demo-client.tsx` används `createGhPagesCloneFn()` som
default. När du klistrar in en URL i UI:t fetchas demo-data från GH
Pages — så du måste ha aktiverat GH Pages på demo-data-repo:t även
för lokal-test, eller använda en lokal HTTP-server för demo-datan
och peka loadern dit explicit via `baseUrl`-prop.

## Vad ingår — och inte — i demon

`scripts/build-demo.sh` flyttar ut server-only-rutter och dynamiska
rutter innan `next build` (de återställs efteråt). I MVP-builden ingår
bara:

- `/` (landningssida)
- `/demo` (GitHub-URL-input + ärendelista från klonat repo)

Resten av appen (`/matters`, `/contacts`, `/invoices`, m.fl.) ligger
utanför demo-builden tills de fått `generateStaticParams()` för sina
dynamiska segment. Fas B-infrastrukturen (`DemoDataStore`,
`createDemoTrpcLink`, `DemoProviders`) finns och kan kopplas in när
sidorna görs statisk-redo.

## Felsökning

| Symptom | Trolig orsak |
|---|---|
| **"Kunde inte hämta demo-manifest..."** | GH Pages är inte aktiverat på demo-data-repo:t, eller `manifest.json` saknas i roten. |
| **"Kunde inte hämta X: HTTP 404"** | Manifestet listar en fil som inte finns. Re-generera manifestet. |
| **404 på `/demo/_next/*`** | Fel `basePath`. CI sätter den automatiskt; för lokal test, sätt `DEMO_BASE_PATH=""`. |
| **Build error: "Page X is missing generateStaticParams"** | En dynamisk route nådde demo-builden. Lägg till den i `STASH_PATHS` i `scripts/build-demo.sh`. |
| **CORS-fel vid fetch** | Repo:t är privat. GH Pages CORS gäller endast publika repos. |

## Varför inte `isomorphic-git` + CORS-proxy?

Tidigare iteration använde `isomorphic-git.clone()` mot
`github.com`/`codeload.github.com`, vilket kräver en CORS-proxy
(public eller egenhostad Cloudflare Worker) eftersom GitHub inte
sätter CORS-headers på git-protokoll-endpoints.

Det nuvarande GH Pages-mönstret:

- ✅ Endast GitHub som dependency
- ✅ Inget extern proxy-deploy
- ✅ Fastly-CDN-cache globalt
- ✅ Mycket generös bandbredd-quota
- ❌ Bara publika repos (men det är ju demo-fallet)
- ❌ Endast HEAD/GET (men det är allt vi behöver — demo är read-only)
- ❌ Ingen git-historik (irrelevant för demo)

För **Tauri/Node-läget** (där git-historik faktiskt är värdefull) finns
`cloneFromGithub()` i `clone-from-github.ts` kvar oförändrad.

## Nästa steg

För att få med fler delar av appen i demon:

1. Lägg till `generateStaticParams()` på de dynamiska rutterna —
   returnera id:n från demo-fixture-data.
2. Wrap:a roten i `<DemoProviders>` i en separat `/demo-app/`-route
   (eller villkorad i `layout.tsx`).
3. Ta bort relevanta paths från `STASH_PATHS`.
4. Pusha → CI bygger om → live på GH Pages.
