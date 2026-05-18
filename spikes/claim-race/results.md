
================================================================
SPIKE: claim-race över git push-CAS
================================================================
Konfiguration:
  Workers:                     15
  Unika claims per worker:     10
  Delade claims:               1 (alla 15 tävlar)
  Total tid (wall clock):      159328 ms

────────────────────────────────────────────────────────────────
Korrekthetstest 1: en SHARED-claim, 15 konkurrenter
────────────────────────────────────────────────────────────────
  Vinnare (worker.won === true):     1
  Förlorare (worker.won === false):  14
  Förväntat: vinnare === 1, förlorare === 14
  Status: ✅ PASS

  Vinnaren: u1
  Genomsnitt försök för förlorare innan de gav upp:
    avg=1.0, max=1

────────────────────────────────────────────────────────────────
Korrekthetstest 2: 15 × 10 unika SOLO-claims
────────────────────────────────────────────────────────────────
  Försök:                            150
  Lyckade:                           150
  Misslyckade:                       0
  Förväntat: alla 150 lyckas (de tävlar inte mot varandra)
  Status: ✅ PASS

────────────────────────────────────────────────────────────────
Datasäkerhet: faktiska JSONL-filen i remote
────────────────────────────────────────────────────────────────
  Rader totalt:                      151
  Parseable JSON:                    151
  Korrupta rader:                    0
  SHARED-rader i filen:              1
  SOLO-rader i filen:                150

  Förväntat: SHARED-rader === 1 (loser-workers ska INTE ha tagit sig in)
  Status: ✅ PASS
  Status: ✅ JSONL integritet OK

────────────────────────────────────────────────────────────────
Prestanda
────────────────────────────────────────────────────────────────
  Lyckade claims totalt:             151
  Försök till framgång (avg/p50/p95/max):
    1.27 / 1 / 2 / 4
  Tid till framgång ms (avg/p50/p95/max):
    11161 / 11419 / 20091 / 21474

  Total throughput:                  0.9 claims/s
================================================================
