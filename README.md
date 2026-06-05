# AVA — ärendehantering för svenska advokat- och juristbyråer

### ▶ **[Prova AVA direkt i webbläsaren → ulrik-s.github.io/ava](https://ulrik-s.github.io/ava/)**

AVA samlar byråns vardag på ett ställe — ärenden, klienter, kalender,
tidregistrering, fakturor och kostnadsräkningar — anpassat efter svensk
juridik.

**Demon kräver ingen inloggning och ingen installation.** Den öppnas direkt
i webbläsaren med exempeldata från en påhittad byrå. Klicka runt fritt: allt
är skrivskyddat, inget sparas och inget påverkar någon riktig data. Stäng
fliken så är allt borta.

> 🔒 **Din data, du bestämmer.** När en byrå kör AVA på riktigt ligger
> uppgifterna i byråns *eget* arkiv. Det finns ingen molntjänst som kan
> stängas av, och känslig klientinformation lämnar aldrig datorn — byggt med
> advokatsekretessen i åtanke.

## Vad du kan prova

- **Ärenden** — lägg upp ärenden med klient, motpart, ombud och domstol, och
  samla alla handlingar per ärende.
- **Kontaktregister** — personer, företag, domstolar, myndigheter,
  försäkringsbolag och andra byråer på ett ställe.
- **Kalender & uppgifter** — dag-, vecka- och månadsvy per medarbetare, med
  att göra-listor.
- **Tid & utlägg** — registrera arbetad tid och utlägg per ärende, markera
  vad som är debiterbart och ta ut periodrapporter.
- **Fakturor & avbetalningsplaner** — acconto- och slutfakturor, kreditering,
  betalningshistorik och avbetalningsplaner med påminnelser.
- **Kostnadsräkningar** — för brottmål (brottmålstaxa) och uppdrag med
  rättshjälp, rättsskydd eller offentlig försvarare.
- **Jävskontroll** — sök på namn och personnummer mot alla ärendens parter
  innan du tar ett uppdrag.
- **Dokumentmallar** — generera färdiga handlingar (fullmakt, stämnings­
  ansökan, kostnadsräkning …) från byråns egna mallar.
- **AI (helt valfritt)** — en språkmodell som körs *lokalt i webbläsaren* kan
  föreslå hur uppladdade dokument ska sorteras. Inget skickas vidare.

> Allt ovan är förifyllt med exempeldata i demon så att du kan se hur det
> hänger ihop. I skarp drift sparas dina ändringar löpande i byråns arkiv.

## Därför AVA

- **Svensk juridisk vardag** — roller, betalningssätt (rättshjälp/rättsskydd/
  offentlig försvarare) och kostnadsräkningar som faktiskt passar en svensk byrå.
- **Datasuveränitet** — byrån äger sin information fullt ut. Ingen
  inlåsning i en tjänst som kan försvinna.
- **Sekretess by design** — klientuppgifter stannar på byråns egna system.
- **Spårbarhet** — varje ändring loggas med vem och när, vilket ger ett
  tydligt revisionsspår.

---

## För utvecklare

> Allt nedanför vänder sig till den som ska köra, bygga eller vidareutveckla
> AVA. Som slutanvändare behöver du bara länken högst upp.

AVA är "git-first": **webbläsaren är runtime**, och all data lagras som JSON +
binärfiler i ett git-repo. Servern är så tunn det går. Två driftlägen:

```
┌─────────────────────────────────────────────────────────────┐
│  Browser-app (Next.js 16 + tRPC, in-memory DemoDataStore)  │
│  ├─ Demo-mode: läser från GitHub Pages CDN (read-only)      │
│  └─ Self-hosted: clone:ar git-repo till OPFS, push:ar       │
└─────────────────────────────────────────────────────────────┘
                          ▲ HTTPS
┌─────────────────────────────────────────────────────────────┐
│  Server (val 1 av 2)                                        │
│  ├─ GitHub Pages: statiska filer (app + data)               │
│  └─ Linux/docker: nginx + git-http-backend + sshd           │
└─────────────────────────────────────────────────────────────┘
```

### Arkitektur i kort

- **Ingen databas**. All data är JSON-rader + binärfiler i ett git-repo.
- **Ingen NextAuth, ingen Prisma, ingen Tauri**.
- **Browsern pratar inte med en backend** — tRPC-routrar körs in-process.
- **Git smart-HTTP** är enda lager mellan browser och server-disk (via `isomorphic-git`).
- **OPFS** (Origin Private File System) håller en lokal working copy.
- **Single source of truth för seed-data**: `tooling/scripts/seed-data.ts` — samma
  fabrik bygger docker-firma.git OCH gh-pages-demon.

Detaljer: [`docs/architecture.md`](./docs/architecture.md).

### Bygg + deploya demon

```bash
yarn install
# CI sköter detta vid push till main: .github/workflows/deploy-demo.yml
# Manuellt:
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh
# → out/ innehåller statisk app + manifest.json + 40 PDF/DOCX
```

### Self-hosted (Linux + docker)

```bash
# 1. Bygg statisk export
DEMO_BASE_PATH=/ava bash tooling/scripts/build-demo.sh

# 2. Starta stack
docker compose -f tooling/docker/docker-compose.yml up -d

# 3. Hämta initial admin-PAT (skrivs en gång i loggen)
docker compose -f tooling/docker/docker-compose.yml logs web | grep "Admin-token"

# 4. Browser: http://localhost:8080/ava/setup → klistra in PAT

# 5. Lägg till fler advokater
tooling/scripts/add-user.sh anna@firma.se
```

Se [`docs/auth.md`](./docs/auth.md) för auth-modellen.

### Dev-server (mot lokal docker)

```bash
yarn install
docker compose -f tooling/docker/docker-compose.yml up -d
yarn dev
# Browser: http://localhost:3000
```

### Seed-data för byrån

```bash
yarn seed:local
# → pushar 5 users, 17 contacts, 15 matters, 40 PDF/DOCX,
#   7 avbetalningsplaner, 20 payments, 25 kalender-events till docker-firma.git
```

### Test + kvalitet

```bash
yarn test:fast           # ~2200 tester
yarn typecheck           # tsc --noEmit
yarn lint                # eslint (flat config)
yarn deps:check          # dependency-cruiser (lagergränser)
yarn knip                # död kod / oanvända deps
yarn round-trip          # E2E mot docker (kräver docker upp)
```

Se [`docs/quality.md`](./docs/quality.md) för verktyg och tröskelvärden.

### Deploy

- [`docs/deploy-demo.md`](./docs/deploy-demo.md) — CI auto-seedad demo på GitHub Pages
- [`docs/deploy-tier3-self-hosted.md`](./docs/deploy-tier3-self-hosted.md) — Linux + docker-stack åt en byrå
- [`docs/auth.md`](./docs/auth.md) — htpasswd-baserad auth + PAT-rotation
