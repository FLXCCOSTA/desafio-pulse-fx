/**
 * Circuit breaker por fonte.
 *
 * O briefing pede explicitamente uma política que evite chamadas descontroladas
 * ou redundantes às APIs externas. O breaker cuida do caso patológico: quando
 * uma fonte está fora do ar, insistir a cada ciclo de sync não traz dado
 * nenhum, queima cota e ainda atrasa a sincronização das fontes saudáveis.
 *
 * Estados:
 *
 *   closed ──(N falhas seguidas)──▶ open ──(passou o cooldown)──▶ half_open
 *      ▲                                                              │
 *      └──────────────(1 sucesso)─────────────────────────────────────┘
 *                                    │
 *                        (1 falha) ──┘──▶ open de novo
 *
 * `half_open` deixa passar uma única tentativa de prova. Sem esse estado, a
 * volta do serviço traria todas as séries de uma vez em avalanche.
 *
 * A classe é pura: recebe o relógio por injeção e não conhece HTTP nem banco,
 * o que a torna testável sem esperar tempo real passar.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Falhas consecutivas que abrem o circuito. */
  readonly failureThreshold: number;
  /** Quanto tempo o circuito fica aberto antes de admitir uma prova. */
  readonly cooldownMs: number;
  /** Injetável para testar sem esperar tempo real. */
  readonly now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(
    readonly source: string,
    readonly retryAfterMs: number,
  ) {
    super(`Circuito aberto para ${source}; nova tentativa em ${retryAfterMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly now: () => number;

  constructor(
    private readonly name: string,
    private readonly options: CircuitBreakerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Executa a operação sob proteção do circuito.
   * Lança `CircuitOpenError` sem sequer tentar quando o circuito está aberto.
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    this.refreshState();

    if (this.state === 'open') {
      const elapsed = this.now() - this.openedAt;
      throw new CircuitOpenError(this.name, Math.max(0, this.options.cooldownMs - elapsed));
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /** O cooldown expirou: admite uma tentativa de prova. */
  private refreshState(): void {
    if (this.state !== 'open') return;
    if (this.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = 'half_open';
    }
  }

  private recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
  }

  private recordFailure(): void {
    // Falha durante a prova devolve o circuito para aberto imediatamente,
    // sem exigir de novo o limiar completo de falhas.
    if (this.state === 'half_open') {
      this.trip();
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) {
      this.trip();
    }
  }

  private trip(): void {
    this.state = 'open';
    this.openedAt = this.now();
  }
}
