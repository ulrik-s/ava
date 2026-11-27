/**
 * Begränsade omförsök för en köpost (#1353). En post vars uppspelning fallerar
 * med ett fel som KAN vara tillfälligt (500, timeout, ett okänt fel) försöks
 * igen med växande väntan — men bara ett begränsat antal gånger. Sedan avvisas
 * den, så att posterna efter den inte hålls som gisslan av en trasig post.
 *
 * Standardgränsen ({@link REPLAY_RETRY_POLICY}): sex försök, med 15 s, 30 s,
 * 1 min, 2 min och 4 min väntan emellan (taket 5 min nås inte med sex försök).
 * En trasig post avvisas alltså tidigast knappt åtta minuter efter första
 * försöket — i praktiken något senare, eftersom synken går var 30:e sekund.
 * Den avvisade posten försvinner inte: den hamnar bland de avvisade ändringarna
 * och kan skickas igen därifrån.
 *
 * Räkningen hålls i minnet (per flik): en omladdning börjar om räkningen för
 * en post som ännu inte avvisats. Köns lagring rörs inte.
 */

/** Hur många försök, och hur länge mellan dem. */
export interface RetryPolicy {
  /** Försök innan posten avvisas (det första räknas). */
  maxAttempts: number;
  /** Väntan efter första misslyckade försöket; fördubblas per försök. */
  baseDelayMs: number;
  /** Längsta väntan mellan två försök. */
  maxDelayMs: number;
}

/** Standardgränsen — se modulkommentaren. */
export const REPLAY_RETRY_POLICY: RetryPolicy = { maxAttempts: 6, baseDelayMs: 15_000, maxDelayMs: 300_000 };

/** En post som väntar på nästa försök. */
export interface PendingRetry {
  /** Misslyckade försök hittills. */
  attempts: number;
  /** Det senaste felet. */
  error: unknown;
  /** Tidigast nästa försök (epoch-ms). */
  retryAt: number;
}

/** Utfallet av ett misslyckat försök. */
export interface FailedAttempt {
  attempts: number;
  /** Gränsen nådd — posten ska avvisas. */
  exhausted: boolean;
}

export class ReplayBackoff {
  private readonly failures = new Map<string, PendingRetry>();

  constructor(
    private readonly policy: RetryPolicy = REPLAY_RETRY_POLICY,
    private readonly now: () => number = Date.now,
  ) {}

  /** Postens väntande omförsök, eller null om den får försökas nu. */
  waiting(mutationId: string): PendingRetry | null {
    const failure = this.failures.get(mutationId);
    return failure && failure.retryAt > this.now() ? failure : null;
  }

  /** Misslyckade försök hittills (0 om inga). */
  attempts(mutationId: string): number {
    return this.failures.get(mutationId)?.attempts ?? 0;
  }

  /** Räkna ett misslyckat försök. */
  fail(mutationId: string, error: unknown): FailedAttempt {
    const attempts = this.attempts(mutationId) + 1;
    if (attempts >= this.policy.maxAttempts) {
      this.failures.delete(mutationId);
      return { attempts, exhausted: true };
    }
    this.failures.set(mutationId, { attempts, error, retryAt: this.now() + this.delay(attempts) });
    return { attempts, exhausted: false };
  }

  /** Posten är klar (accepterad eller avvisad) — glöm dess försök. */
  clear(mutationId: string): void {
    this.failures.delete(mutationId);
  }

  private delay(attempts: number): number {
    return Math.min(this.policy.baseDelayMs * 2 ** (attempts - 1), this.policy.maxDelayMs);
  }
}
