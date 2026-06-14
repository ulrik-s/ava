# ADR 0014 — Release-distribution: GHCR-images + compose-bundle + config-generator + trial-Keycloak

- **Status:** Accepterad
- **Datum:** 2026-06-14
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** `release.yml` (#87), docker-stacken (`tooling/docker/`), install-server (#232/#323), bootstrap-installern (#325/#326), self-hosted-drift
- **Relaterat:** [ADR 0005](./0005-server-som-git-peer.md) (server-runtime), [ADR 0008](./0008-secrets-valv-krypterad-fil.md) (secrets-valv), [ADR 0009](./0009-oidc-login-via-servern.md) (OIDC / BYO-IdP), [ADR 0013](./0013-office-add-in-arkitektur.md)

## Kontext

AVA-server ska gå att **installera på en server från en GitHub-release**. Idag
bygger `docker compose` images ur källan (`build: context: ../..`) och bootstrap-
installern (#325) drar **käll-tarballen** + bygger på plats (kräver bun + full
källbyggnad). Vi vill i stället distribuera **körbara docker-images** + en tunn
orkestrering, så en byrå kör `docker compose pull && up` utan att bygga.

Stacken (verifierad): **egna images** byggda ur `tooling/docker/{web,server-
runtime,git-ssh,auth-server}/Dockerfile`; **upstream** `quay.io/keycloak/
keycloak:26.0` + `quay.io/oauth2-proxy/oauth2-proxy:v7.6.0`. Konfig i
`nginx*.conf` + `keycloak/realm-ava.json`.

## Beslut

### 1. Egna images publiceras till GHCR per release (A)

`release.yml` bygger + pushar **våra** images (`ava-web`, `ava-server-runtime`;
`ava-git-ssh` + `ava-auth` opt-in) till **GHCR**, multi-arch (amd64+arm64),
taggade med release-taggen (utöver binärerna den redan bygger). De **två
upstream-imagesen pinnas** och byggs ALDRIG om. Frontend (`out/`) **COPY:as in i
`ava-web` vid bygget** (i st.f. dagens host-bind-mount) → self-contained image.

### 2. Compose + konfig distribueras som en release-bundle (strategi A)

En **`ava-server-<tag>.tar.gz`** bifogas releasen: `docker-compose.yml` +
overlays + `nginx*.conf` + realm-mall + `.env.example` + bootstrap-scriptet.
Compose refererar GHCR-images via **samma release-tagg** (så `compose pull` ger
matchande images). Bootstrap-installern (#325) drar **bundlen** i st.f. käll-
tarballen och kör `docker compose pull && up`.

*Förkastat:* (B) baka in all konfig i images (ändring kräver ombygge; per-install-
konfig kan ändå inte bakas), (C) OCI-compose-artefakt (för omoget/okänt).

### 3. Initial setup = engångs config-generator-image (`ava-installer`)

Setup görs av en **one-shot-image**: `docker run -v ./config:/out ava-installer
--config install.json` genererar secrets-valv + `.env` (+ realm vid trial-Keycloak)
till en mountad host-katalog. **Host:en** kör sedan `docker compose up`.
Installern **orkestrerar inte docker** (ingen docker-in-docker / socket-mount) —
den genererar konfig och kör tjänste-kontrollerna (#323) efter att stacken är uppe.

### 4. Bundlad Keycloak är ENDAST för trial; produktion = BYO-IdP

- **Trial/utvärdering:** bundlad Keycloak körs `start-dev` (H2 in-memory,
  **ephemeral** — data försvinner vid omstart), dev-/genererad realm. Noll konfig.
- **Produktion:** **BYO-IdP** (Entra/Google, [ADR 0009](./0009-oidc-login-via-servern.md))
  är default. Bundlad Keycloak-i-prod (Postgres + persisterad realm + HTTPS-issuer)
  byggs INTE nu — vi undviker att underhålla en halv-IdP-drift.

### 5. `git-ssh` + `auth` är opt-in-profiler

Default-stacken = `web` + `server-runtime` (+ `oauth2-proxy`/`keycloak` när OIDC/
trial). `git-ssh` (git-över-SSH) och `auth` (invite-server) startas bara via
`--profile`. HTTP-git går via `ava-web`; SSH är opt-in.

## Konsekvenser

- **+** Standard-ops: `docker compose pull && up` mot pinnade GHCR-images; ingen
  källbyggnad på servern (bun krävs ej i drift).
- **+** Konfig versionerad ihop med images i bundlen; transparent + redigerbar.
- **+** Ren separation: `ava-installer` = config + verifiering, host-docker = kör.
- **−** Två artefakt-typer per release (images + bundle); compose:s image-taggar
  MÅSTE matcha release-taggen (release-CI sätter dem).
- **−** `release.yml` växer med en `docker buildx build --push`-matris (4 images
  × 2 arch) + bundle-paketering.
- **−** Trial-Keycloak tappar data vid omstart (medvetet — trial, ej prod).

## Alternativ (förkastade)

- **Bygg ur källan på servern (nuläget)** — kräver bun + full Next-build; långsamt
  + tungt för en byrå-server. Image-pull är driftstandarden.
- **Baka in all konfig (B)** / **OCI-compose (C)** — se §2.
- **docker-in-docker-installer** — socket-mount är skört/säkerhetskänsligt; config-
  generator-mönstret (§3) undviker det.
- **Prod-Keycloak i releasen** — Postgres + realm-livscykel + HTTPS = en hel IdP-
  drift att underhålla; BYO-IdP är bättre för prod (§4).
