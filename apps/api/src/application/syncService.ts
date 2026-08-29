/**
 * Serviço de sincronização.
 *
 * O briefing pede uma política clara de atualização que evite chamadas
 * descontroladas ou redundantes às APIs externas. A política aqui tem quatro
 * camadas, da mais barata para a mais cara:
 *
 * 1. **TTL por periodicidade.** Série mensal não muda de hora em hora: buscar
 *    o IPCA a cada dois minutos é desperdício puro. O TTL sai da frequência
 *    declarada da série, não de um número mágico global.
 * 2. **Circuit breaker por fonte.** Fonte fora do ar não é consultada de novo
 *    até o cooldown passar.
 * 3. **Janela incremental.** Depois da primeira carga, só o intervalo desde a
 *    última observação conhecida é pedido — não a série inteira.
 * 4. **Backoff no cliente HTTP**, para falha transitória dentro da tentativa.
 *
 * Nada disso depende de o usuário abrir a página: a sincronização é agendada, e
 * a requisição do usuário sempre lê do banco. Isso mantém a latência previsível
 * e desacopla o tempo de resposta da saúde das fontes externas.
 */

import type { Observation } from '../domain/series';
import type { CircuitBreaker } from './circuitBreaker';

export type SyncTrigger = 'schedule' | 'startup' | 'admin';

export type SyncOutcome = 'success' | 'skipped_fresh' | 'skipped_circuit_open' | 'failed';

export interface SeriesToSync {
  readonly id: string;
  readonly source: 'bcb_sgs' | 'fred';
  readonly externalId: string;
  readonly frequency: 'daily' | 'monthly';
}

export interface SyncResult {
  readonly seriesId: string;
  readonly outcome: SyncOutcome;
  readonly rowsUpserted: number;
  readonly errorMessage?: string;
}

/**
 * Quanto tempo um dado persistido continua "fresco".
 *
 * Diário: 2 horas. A PTAX de fechamento sai uma vez ao dia, mas a janela curta
 * cobre republicação e atraso do BCB sem custo relevante.
 *
 * Mensal: 12 horas. O IPCA sai uma vez por mês; qualquer coisa mais agressiva
 * seria consumo de cota sem contrapartida.
 */
export const TTL_BY_FREQUENCY: Readonly<Record<'daily' | 'monthly', number>> = {
  daily: 2 * 60 * 60 * 1000,
  monthly: 12 * 60 * 60 * 1000,
};

/** Quanto histórico buscar quando a série ainda não tem nada persistido. */
export const INITIAL_BACKFILL_DAYS: Readonly<Record<'daily' | 'monthly', number>> = {
  daily: 5 * 365,
  monthly: 10 * 365,
};

/**
 * Sobreposição aplicada à janela incremental.
 *
 * Sem ela, uma revisão da fonte sobre um dado já baixado nunca seria percebida.
 * Cinco dias é barato — o upsert é idempotente, então reprocessar não duplica —
 * e cobre o caso comum de revisão recente.
 */
const INCREMENTAL_OVERLAP_DAYS = 5;

export interface SyncDependencies {
  readonly fetchObservations: (
    series: SeriesToSync,
    fromIso: string,
    toIso: string,
  ) => Promise<Observation[]>;
  readonly upsertObservations: (seriesId: string, rows: readonly Observation[]) => Promise<number>;
  readonly findLatestDate: (seriesId: string) => Promise<string | null>;
  readonly recordRun: (
    seriesId: string,
    trigger: SyncTrigger,
    outcome: SyncOutcome,
    rowsUpserted: number,
    errorMessage?: string,
  ) => Promise<void>;
  readonly breakerFor: (source: SeriesToSync['source']) => CircuitBreaker;
  readonly now: () => Date;
  /** Momento da última sincronização bem-sucedida, em memória do processo. */
  readonly lastSyncAt: Map<string, number>;
}

/** Soma (ou subtrai) dias a uma data ISO, no calendário UTC. */
export function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export class SyncService {
  constructor(private readonly deps: SyncDependencies) {}

  /**
   * Sincroniza uma série. O disparo `admin` ignora o TTL de propósito: é o
   * escape manual para quando se quer forçar atualização. O circuit breaker,
   * porém, continua valendo — nem o admin deve martelar uma fonte fora do ar.
   */
  async syncSeries(series: SeriesToSync, trigger: SyncTrigger): Promise<SyncResult> {
    if (trigger !== 'admin' && this.isFresh(series)) {
      await this.deps.recordRun(series.id, trigger, 'skipped_fresh', 0);
      return { seriesId: series.id, outcome: 'skipped_fresh', rowsUpserted: 0 };
    }

    const today = this.deps.now().toISOString().slice(0, 10);
    const latest = await this.deps.findLatestDate(series.id);

    const from = latest
      ? shiftDays(latest, -INCREMENTAL_OVERLAP_DAYS)
      : shiftDays(today, -INITIAL_BACKFILL_DAYS[series.frequency]);

    try {
      const breaker = this.deps.breakerFor(series.source);
      const observations = await breaker.execute(() =>
        this.deps.fetchObservations(series, from, today),
      );

      const rowsUpserted = await this.deps.upsertObservations(series.id, observations);
      this.deps.lastSyncAt.set(series.id, this.deps.now().getTime());

      await this.deps.recordRun(series.id, trigger, 'success', rowsUpserted);
      return { seriesId: series.id, outcome: 'success', rowsUpserted };
    } catch (error) {
      const isCircuitOpen = error instanceof Error && error.name === 'CircuitOpenError';
      const outcome: SyncOutcome = isCircuitOpen ? 'skipped_circuit_open' : 'failed';
      // Mensagem própria, nunca o corpo cru da resposta da fonte: ele pode
      // carregar a URL completa, e a URL do FRED contém a chave de API.
      const errorMessage = error instanceof Error ? error.message : 'erro desconhecido';

      await this.deps.recordRun(series.id, trigger, outcome, 0, errorMessage);
      return { seriesId: series.id, outcome, rowsUpserted: 0, errorMessage };
    }
  }

  /**
   * Sincroniza várias séries em sequência, e não em paralelo.
   *
   * Deliberado: sete séries disparadas de uma vez contra duas fontes é
   * exatamente o "chamadas descontroladas" que o briefing manda evitar, e o SGS
   * já se mostrou lento (14,4 s medidos). Sequencial também garante que uma
   * fonte lenta não roube conexão das demais.
   */
  async syncAll(seriesList: readonly SeriesToSync[], trigger: SyncTrigger): Promise<SyncResult[]> {
    const results: SyncResult[] = [];

    for (const series of seriesList) {
      results.push(await this.syncSeries(series, trigger));
    }

    return results;
  }

  private isFresh(series: SeriesToSync): boolean {
    const last = this.deps.lastSyncAt.get(series.id);
    if (last === undefined) return false;

    return this.deps.now().getTime() - last < TTL_BY_FREQUENCY[series.frequency];
  }
}
