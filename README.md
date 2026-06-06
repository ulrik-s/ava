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

## Dokumentation

Teknisk dokumentation för den som ska köra, bygga eller vidareutveckla AVA:

- [`docs/development.md`](./docs/development.md) — bygg, kör, self-hosted, dev-server, seed, test, deploy
- [`docs/architecture.md`](./docs/architecture.md) — arkitektur (git-first, tre lager)
- [`docs/auth.md`](./docs/auth.md) — auth-modell (htpasswd + PAT)
- [`docs/deploy-demo.md`](./docs/deploy-demo.md) — demo-deploy på GitHub Pages
- [`docs/deploy-tier3-self-hosted.md`](./docs/deploy-tier3-self-hosted.md) — self-hosted Linux/docker
- [`docs/document-text-extraction.md`](./docs/document-text-extraction.md) — textextraktion ur PDF/DOCX
- [`docs/quality.md`](./docs/quality.md) — verktyg och tröskelvärden
- [`docs/test-and-tooling-status.md`](./docs/test-and-tooling-status.md) — test-/tooling-status
- [`docs/adr/`](./docs/adr/) — arkitekturbeslut (ADR 0001–0003)
- [`AGENTS.md`](./AGENTS.md) — arbetssätt (Issue → PR → Merge) och projektregler
