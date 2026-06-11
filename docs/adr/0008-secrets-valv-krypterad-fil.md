# ADR 0008 — Secrets-valv: krypterad fil i server-data-dir

- **Status:** Accepterad
- **Datum:** 2026-06-11
- **Beslutsfattare:** Ulrik Sjölin
- **Berör:** server-runtime (ADR 0005), Fortnox-connector (#82), framtida server-connectorer (SMTP m.fl.)
- **Issue:** [#79](https://github.com/ulrik-s/ava/issues/79)
- **Relaterat:** [ADR 0005](./0005-server-som-git-peer.md) (tunn git-peer-server), [#82](https://github.com/ulrik-s/ava/issues/82) (Fortnox)

## Kontext

Server-runtime:n behöver hålla hemligheter som inte hör hemma i git-db:n:
Fortnox `client_secret` + OAuth-tokens, och senare SMTP-creds m.m.

Två krav gör att **env-variabler inte räcker**:

1. **Skrivbart i runtime.** Fortnox refresh-tokens **roterar** — varje refresh
   ger en ny refresh-token och ogiltigförklarar den gamla. Connectorn måste
   kunna *skriva tillbaka* den nya, och den måste överleva omstart. En env-var
   är read-only för processen.
2. **Krypterat i vila.** Hemligheter på disk i klartext är oacceptabelt.

USP:n (ingen tredjeparts-infra) utesluter en extern secret-manager för
baslinjen.

## Beslut

Ett **secrets-valv som en AES-256-GCM-krypterad fil** i serverns data-katalog.

- `SecretsVault`-interface (`get`/`set`/`delete`) + `EncryptedFileVault`.
- Hela nyckel/värde-kartan lagras som **en** krypterad blob (AES-256-GCM,
  autentiserad → fel nyckel/manipulation upptäcks).
- **Master-nyckeln injiceras via env** (`AVA_SECRETS_KEY`, base64-kodade 32 byte)
  och ligger aldrig på disk med chiffertexten.
- **Filvägen sätts separat** (`AVA_SECRETS_FILE`) och ligger **utanför
  git-working-copy:n** — secrets-in-git undviks helt.
- Atomisk skrivning (tmp + rename), `0600`-rättigheter.
- `fs` injiceras (`VaultFs`) → enhetstestbart utan disk.

Fortnox-token-store:n får en `VaultFortnoxTokenStore` backad av valvet, vilket
löser rotations-kravet utan att ändra connectorns interface.

## Konsekvenser

- **+** Skrivbart, persistent, krypterat — uppfyller rotations-kravet; ingen
  extern infra.
- **+** Generiskt — återanvänds för alla framtida server-secrets.
- **−** Nyckelhantering blir driftens ansvar (env/host-secret). Tappad
  `AVA_SECRETS_KEY` ⇒ valvet oläsbart (byrån re-authar mot Fortnox).
- **−** En master-nyckel för hela valvet (ingen per-secret-nyckel) — rimligt
  för en single-tenant self-hosted server.

## Alternativ (förkastade)

- **Krypterad blob i git-db:n** — secrets skulle resa med repo:t och kopplas
  till sync; högre läckage-yta även krypterat. Nej.
- **Extern secret-manager (Vault/KMS/SOPS)** — mest robust men bryter
  USP:n (tredjeparts-infra) för baslinjen. Kan läggas till som en
  alternativ `SecretsVault`-impl senare utan att röra konsumenterna.
- **Env-only** — kan inte skriva tillbaka roterade refresh-tokens. Nej.
