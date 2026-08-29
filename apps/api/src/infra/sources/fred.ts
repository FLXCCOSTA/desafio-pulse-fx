/**
 * Cliente do FRED — Federal Reserve Economic Data, St. Louis Fed.
 *
 * Formato confirmado contra a API real em 28/08/2026:
 *
 *   GET https://api.stlouisfed.org/fred/series/observations
 *       ?series_id=DGS10&api_key=...&file_type=json
 *
 *   {"observations":[{"date":"2026-08-27","value":"4.21"}, ...]}
 *
 * Armadilha verificada na prática: em feriado americano o FRED devolve
 * `"value": "."` em vez de omitir a linha. Lido como número, isso vira zero —
 * um Treasury de 0% e uma variação absurda no dashboard. O parser descarta.
 */

import type { Observation } from '../../domain/series';
import { type HttpClient } from '../http/httpClient';

export const FRED_HOST = 'api.stlouisfed.org';

/** Marcador de dado ausente usado pelo FRED. */
const MISSING_VALUE = '.';

interface FredRow {
  readonly date?: unknown;
  readonly value?: unknown;
}

interface FredPayload {
  readonly observations?: unknown;
}

export function parseFredResponse(payload: unknown): Observation[] {
  const rows = (payload as FredPayload | null)?.observations;
  if (!Array.isArray(rows)) return [];

  const observations: Observation[] = [];

  for (const row of rows as FredRow[]) {
    if (typeof row?.date !== 'string' || typeof row?.value !== 'string') continue;
    if (row.value.trim() === MISSING_VALUE) continue;

    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;

    observations.push({ referenceDate: row.date, value });
  }

  return observations;
}

export class FredClient {
  constructor(
    private readonly http: HttpClient,
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.stlouisfed.org/fred',
  ) {
    if (!apiKey) {
      throw new Error('FRED_API_KEY ausente: a integração com o FRED não pode ser inicializada.');
    }
  }

  async fetchSeries(seriesId: string, fromIso: string, toIso: string): Promise<Observation[]> {
    const query = new URLSearchParams({
      series_id: seriesId,
      api_key: this.apiKey,
      file_type: 'json',
      observation_start: fromIso,
      observation_end: toIso,
      sort_order: 'asc',
    });

    const payload = await this.http.getJson(
      `${this.baseUrl}/series/observations?${query.toString()}`,
    );
    return parseFredResponse(payload);
  }
}
