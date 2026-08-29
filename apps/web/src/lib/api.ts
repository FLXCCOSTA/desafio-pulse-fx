/**
 * Cliente da API.
 *
 * Valida toda resposta com os schemas Zod do pacote de contratos. Confiar
 * cegamente no formato do servidor é o que produz aquele `undefined is not an
 * object` no meio da tela: se o contrato quebrar, o erro aparece aqui, com
 * mensagem clara, e não três componentes adiante.
 */

import {
  indicatorDetailSchema,
  indicatorSummarySchema,
  favoritesResponseSchema,
  type HistoryWindow,
  type IndicatorDetail,
  type IndicatorSummary,
} from '@pulse-fx/contracts';
import { z } from 'zod';

const indicatorsResponseSchema = z.object({
  indicators: z.array(indicatorSummarySchema),
});

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      // Sem isto o cookie de sessão não acompanha a requisição, e os favoritos
      // simplesmente não persistiriam.
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
      ...init,
    });
  } catch {
    throw new ApiError('Não foi possível falar com o servidor.', 0);
  }

  if (!response.ok) {
    // A mensagem do servidor é deliberadamente genérica; usamos a dela quando
    // existe, e um texto próprio quando não.
    const fallback =
      response.status === 404 ? 'Indicador não encontrado.' : 'O servidor recusou a requisição.';

    let message = fallback;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'message' in body) {
        message = String(body.message);
      }
    } catch {
      // Corpo não-JSON: mantém o texto padrão.
    }

    throw new ApiError(message, response.status);
  }

  return schema.parse(await response.json());
}

export const api = {
  listIndicators: (signal?: AbortSignal): Promise<IndicatorSummary[]> =>
    request('/api/indicators', indicatorsResponseSchema, signal ? { signal } : {}).then(
      (data) => data.indicators,
    ),

  getIndicator: (
    id: string,
    window: HistoryWindow,
    signal?: AbortSignal,
  ): Promise<IndicatorDetail> =>
    request(
      `/api/indicators/${encodeURIComponent(id)}?window=${window}`,
      indicatorDetailSchema,
      signal ? { signal } : {},
    ),

  addFavorite: (seriesId: string): Promise<{ seriesIds: string[] }> =>
    request('/api/favorites', favoritesResponseSchema, {
      method: 'POST',
      body: JSON.stringify({ seriesId }),
    }),

  removeFavorite: (seriesId: string): Promise<{ seriesIds: string[] }> =>
    request(`/api/favorites/${encodeURIComponent(seriesId)}`, favoritesResponseSchema, {
      method: 'DELETE',
    }),
};
