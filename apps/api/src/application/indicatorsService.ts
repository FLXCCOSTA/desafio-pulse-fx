/**
 * Montagem dos indicadores para o dashboard e a tela de detalhe.
 *
 * O cálculo da variação acontece **aqui**, no servidor, e nunca no cliente.
 * Se o front recalculasse, dashboard e detalhe poderiam divergir por diferença
 * de arredondamento ou de versão do bundle — exatamente a inconsistência que o
 * briefing manda evitar. O cliente recebe o número pronto e o texto que o
 * explica.
 */

import { HISTORY_WINDOW_DAYS, type HistoryWindow } from '@pulse-fx/contracts';
import type { IndicatorDetail, IndicatorSummary, Variation } from '@pulse-fx/contracts';

import { DEFAULT_VARIATION_POLICY, MEDIUM_TERM_POLICY, type Observation } from '../domain/series';
import { calculateVariation } from '../domain/variation';
import type { ObservationsRepository } from '../infra/db/observationsRepository';
import type { SeriesRecord, SeriesRepository } from '../infra/db/seriesRepository';

/**
 * A partir de quantos dias sem observação nova a série é considerada defasada.
 *
 * Diária: 4 dias cobre um fim de semana prolongado por feriado sem alarme falso.
 *
 * Mensal: 70 dias. O limiar anterior, de 45, marcava IPCA e CPI como defasados
 * em operação normal — erro observado ao rodar o sistema em 29/08/2026, quando
 * a observação mais recente era 01/07 e a distância já passava de 59 dias.
 *
 * A conta que 45 ignorava: a série é datada no primeiro dia do mês, então já
 * nasce com até 31 dias de idade quando o mês fecha, e a publicação leva mais
 * duas a três semanas. Alarme que dispara em operação normal deixa de ser
 * informação e vira ruído que o usuário aprende a ignorar.
 */
export const STALE_AFTER_DAYS: Readonly<Record<'daily' | 'monthly', number>> = {
  daily: 4,
  monthly: 70,
};

/** Quanto histórico o cálculo precisa ver, por tipo de série. */
const LOOKBACK_DAYS_FOR_VARIATION: Readonly<Record<'daily' | 'monthly', number>> = {
  // Cobre a janela de 21 pregões e feriados prolongados com folga.
  daily: 120,
  // Cobre a comparação interanual com margem para mês faltante.
  monthly: 500,
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function toContractVariation(
  observations: readonly Observation[],
  series: SeriesRecord,
  medium: boolean,
): Variation {
  const policy = medium ? MEDIUM_TERM_POLICY[series.kind] : DEFAULT_VARIATION_POLICY[series.kind];
  const result = calculateVariation(observations, series.kind, { policy });

  return {
    change: result.change,
    unit: result.unit,
    label: result.label,
    baselineDate: result.baseline?.referenceDate ?? null,
    unavailableReason: result.unavailableReason,
  };
}

export class IndicatorsService {
  constructor(
    private readonly seriesRepository: SeriesRepository,
    private readonly observationsRepository: ObservationsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private isStale(series: SeriesRecord, latestDate: string | null): boolean {
    if (!latestDate) return true;

    const today = this.now().toISOString().slice(0, 10);
    return daysBetween(latestDate, today) > STALE_AFTER_DAYS[series.frequency];
  }

  private buildSummary(
    series: SeriesRecord,
    history: readonly Observation[],
    favorites: ReadonlySet<string>,
  ): IndicatorSummary {
    const latest = history.at(-1) ?? null;

    return {
      id: series.id,
      name: series.name,
      source: series.source,
      kind: series.kind,
      unit: series.unit,
      frequency: series.frequency,
      latestValue: latest?.value ?? null,
      referenceDate: latest?.referenceDate ?? null,
      variation: toContractVariation(history, series, false),
      stale: this.isStale(series, latest?.referenceDate ?? null),
      isFavorite: favorites.has(series.id),
    };
  }

  /** Cards do dashboard, com favoritos da sessão já resolvidos. */
  async listIndicators(favoriteIds: readonly string[]): Promise<IndicatorSummary[]> {
    const favorites = new Set(favoriteIds);
    const seriesList = await this.seriesRepository.findActive();

    // Sequencial e não Promise.all: são 7 séries contra um único pool de
    // conexões, e disparar tudo de uma vez só disputaria as mesmas conexões.
    const summaries: IndicatorSummary[] = [];

    for (const series of seriesList) {
      const history = await this.observationsRepository.findWindow(
        series.id,
        LOOKBACK_DAYS_FOR_VARIATION[series.frequency],
      );

      summaries.push(this.buildSummary(series, history, favorites));
    }

    return summaries;
  }

  async getIndicator(
    seriesId: string,
    window: HistoryWindow,
    favoriteIds: readonly string[],
  ): Promise<IndicatorDetail | null> {
    const series = await this.seriesRepository.findById(seriesId);
    if (!series) return null;

    // Busca o maior entre a janela pedida e o mínimo que o cálculo exige, para
    // que a variação não fique indisponível só porque o usuário escolheu 30 dias
    // numa série mensal.
    const requestedDays = HISTORY_WINDOW_DAYS[window];
    const neededDays = Math.max(requestedDays, LOOKBACK_DAYS_FOR_VARIATION[series.frequency]);

    const full = await this.observationsRepository.findWindow(series.id, neededDays);
    const summary = this.buildSummary(series, full, new Set(favoriteIds));

    // O gráfico mostra apenas a janela pedida, mesmo que o cálculo tenha visto mais.
    const latestDate = full.at(-1)?.referenceDate;
    const history = latestDate
      ? full.filter((item) => daysBetween(item.referenceDate, latestDate) <= requestedDays)
      : [];

    return {
      ...summary,
      rationale: series.rationale,
      limitations: series.limitations,
      docUrl: series.docUrl,
      history,
      mediumTermVariation: toContractVariation(full, series, true),
    };
  }
}
