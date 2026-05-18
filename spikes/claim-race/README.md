# Spike: claim-race över git push-CAS

Validerar antagandet i `docs/architecture-future.md` §3.7 att vi kan använda
`git push` som en distribuerad mutex för regel-exekvering, med 10–20 klienter
som tävlar mot samma JSONL-fil samtidigt.

## Vad vi vill mäta

1. **Korrekthet:** vid N samtidiga claimers av samma claimId — exakt en lyckas?
2. **Korrekthet:** vid N samtidiga claimers av *olika* claimIds — alla lyckas
   till slut (med retries)?
3. **Prestanda:** hur lång tid tar en lyckad claim med 15 konkurrerande klienter?
4. **Datasäkerhet:** kan JSONL-filen bli korrupt vid race?
5. **Crash-resistens:** vad händer om en klient kraschar mellan commit och push?

## Hur testet körs

```bash
bash run.sh
```

Setup: skapar ett bare git-repo + 15 worker-kloner i `/tmp/spike-claim-race`.
Varje worker försöker claima 10 olika events (för korrekthetstest 2) **och**
samma event som alla andra (för korrekthetstest 1).

## Resultat

Skrivs till `results.md` efter körning.
