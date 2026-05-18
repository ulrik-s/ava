# Claim-race spike — sammanfattning

Validerar arkitekturen i `docs/architecture-future.md` §3.7.

## Tre varianter testade

| # | Variant | Avg försök | P95 försök | Max försök | Korrekthet |
|---|---|---|---|---|---|
| 1 | JSONL-per-dag (din begäran) | 9.95 | 82 | 141 | ✅ |
| 2 | Claim-per-fil | 9.01 | 66 | 141 | ✅ |
| 3 | JSONL-per-dag + preferred-runner | **1.27** | **2** | **4** | ✅ |

Alla 15 workers, 150 unika solo-claims + 1 delad claim med 15 tävlare. Alla
varianter hade noll JSONL-korruption och exakt 1 vinnare av delad claim.

## Slutsatser

### 1. Git CAS sker på ref-nivå, inte fil-nivå

Variant 1 (JSONL-per-dag) och variant 2 (claim-per-fil) har **identisk
push-prestanda**. När 15 klienter pushar till samma `refs/heads/main` får
14 stycken non-fast-forward oavsett om de ändrat samma eller olika filer.

**Konsekvens för arkitekturen:** vi förlorar inget prestandamässigt på att
behålla JSONL-per-dag-formatet (en fil per dag istället för tusen små
filer i mappen). Bekräftar designvalet i `architecture-future.md`.

### 2. Preferred-runner är nödvändig

Utan optimering: 15 klienter konkurrerar = avg 10 retries per claim, p95 = 82.
Med preferred-runner: nästan ingen konkurrens = avg 1.27, p95 = 2.

**Konsekvens för arkitekturen:** §3.7 i arkitekturdoc:n beskriver detta som
en "optimering". Spiken visar att det är ett **krav**, inte en optimering.
Utan den kan en burst på 30 claims/s ta minuter att rensa.

### 3. Korrekthet är robust

Inga JSONL-rader korrupta. Inga duplicerade vinnare. Inga förlorade solo-claims.
Git's compare-and-swap-semantik håller även under hög konkurrens.

**Konsekvens för arkitekturen:** vi kan lita på git som distribuerad mutex
för regel-exekvering. Inget behov av en separat koordinator-server.

## Bör implementeras i fas 3

- `tryClaim(claimId, eventId)` med preferred-runner-pre-step
- `hash(claimId + userId)` för deterministisk rank-ordning
- Primary försöker direkt (delay = 0)
- Rank ≥ 1 väntar `15s + jitter(0..5s)` × rank innan retry
- Stale-claim-failover: efter 5 min utan motsvarande `rule.executed`-event
  får nästa rank försöka
- Idempotency-key på alla externa side-effects (`email.send`, etc.) för att
  hantera de sällsynta fall där två klienter ändå råkar köra samtidigt

## Producent-noteringar för testet

Spiken kör mot lokalt filsystem (`/tmp`). Verklig SSH-server tillkommer
RTT-latens (~10-50 ms per push). Det förvärrar inte mätningarna eftersom
de redan är bound av retry-loopar, inte av nät-latens.

Spiken har inte testat:
- Stale-claim-failover (kraschad klient mitt i)
- Real SSH-server med många concurrent connections (sshd-throttling)
- Mycket stora claim-loggar (~10 000 rader)

De är värda att testa när vi närmar oss fas 3-implementation.
