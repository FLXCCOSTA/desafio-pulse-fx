/**
 * Cliente do SGS — Sistema Gerenciador de Séries Temporais do Banco Central.
 *
 * Formato confirmado contra a API real em 28/08/2026:
 *
 *   GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.1/dados
 *       ?formato=json&dataInicial=01/08/2026&dataFinal=28/08/2026
 *
 *   [{"data":"03/08/2026","valor":"5.0723"}, ...]
 *
 * Duas armadilhas verificadas na prática:
 *
 * 1. O caminho `/dados/ultimos/N` devolve uma página HTML de "Requisição
 *    inválida", não JSON. Só o intervalo de datas funciona.
 * 2. As datas vão e voltam em `dd/MM/yyyy`, não em ISO. Converter na fronteira
 *    e nunca deixar esse formato vazar para o domínio.
 */

import type { Observation } from '../../domain/series';
import { HttpClient } from '../http/httpClient';

export const BCB_HOST = 'api.bcb.gov.br';

/** `dd/MM/yyyy` → `YYYY-MM-DD`. Devolve `null` se o formato não bater. */
export function parseBcbDate(raw: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!match) return null;

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD` → `dd/MM/yyyy`, formato que o SGS exige na query. */
export function toBcbDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

interface BcbRow {
  readonly data?: unknown;
  readonly valor?: unknown;
}

/**
 * Converte a resposta crua em observações do domínio.
 *
 * Linhas com data ou valor inutilizável são descartadas em silêncio, não
 * convertidas em zero: um câmbio de 0,00 no gráfico seria pior que um buraco.
 */
export function parseSgsResponse(payload: unknown): Observation[] {
  if (!Array.isArray(payload)) return [];

  const observations: Observation[] = [];

  for (const row of payload as BcbRow[]) {
    if (typeof row?.data !== 'string' || typeof row?.valor !== 'string') continue;

    const referenceDate = parseBcbDate(row.data);
    if (!referenceDate) continue;

    const value = Number(row.valor);
    if (!Number.isFinite(value)) continue;

    observations.push({ referenceDate, value });
  }

  return observations;
}

export class BcbSgsClient {
  constructor(
    private readonly http: HttpClient,
    private readonly baseUrl = 'https://api.bcb.gov.br/dados/serie',
  ) {}

  /**
   * Busca observações de uma série no intervalo pedido.
   * `seriesCode` é o código numérico do SGS (ex.: `1` para o dólar de venda).
   */
  async fetchSeries(seriesCode: string, fromIso: string, toIso: string): Promise<Observation[]> {
    const url =
      `${this.baseUrl}/bcdata.sgs.${encodeURIComponent(seriesCode)}/dados` +
      `?formato=json&dataInicial=${encodeURIComponent(toBcbDate(fromIso))}` +
      `&dataFinal=${encodeURIComponent(toBcbDate(toIso))}`;

    const payload = await this.http.getJson(url);
    return parseSgsResponse(payload);
  }
}
