/**
 * Contratos compartilhados entre a API e o cliente web.
 *
 * Este pacote é a única fonte de verdade do formato de dados que cruza a
 * fronteira HTTP. O mesmo schema Zod valida a entrada no servidor e gera os
 * tipos do cliente — quebra de contrato vira erro de compilação, não bug em
 * produção descoberto pelo usuário.
 */

import { z } from 'zod';

/** Data no calendário civil, ISO `YYYY-MM-DD`. */
export const referenceDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve estar no formato YYYY-MM-DD');

export const seriesKindSchema = z.enum([
  'fx_daily',
  'policy_rate',
  'yield_daily',
  'macro_monthly',
]);

export const variationUnitSchema = z.enum(['percent', 'percentage_points']);

export const sourceSchema = z.enum(['bcb_sgs', 'fred']);

export const frequencySchema = z.enum(['daily', 'monthly']);

export const variationUnavailableReasonSchema = z.enum([
  'no_observations',
  'no_baseline',
  'zero_baseline',
]);

export const observationSchema = z.object({
  referenceDate: referenceDateSchema,
  value: z.number().finite(),
});

/**
 * Variação já calculada pelo servidor.
 *
 * O cálculo nunca é refeito no cliente: se o front recalculasse, dashboard e
 * detalhe poderiam divergir, que é exatamente o que o briefing pede para evitar.
 */
export const variationSchema = z.object({
  /** `null` quando não foi possível calcular; `unavailableReason` diz por quê. */
  change: z.number().finite().nullable(),
  unit: variationUnitSchema,
  /** Texto curto exibido junto do número, ex.: "vs. pregão anterior". */
  label: z.string(),
  baselineDate: referenceDateSchema.nullable(),
  unavailableReason: variationUnavailableReasonSchema.nullable(),
});

/** Card do dashboard. */
export const indicatorSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: sourceSchema,
  kind: seriesKindSchema,
  unit: z.string().min(1),
  frequency: frequencySchema,
  latestValue: z.number().finite().nullable(),
  /** Data da observação exibida — nunca a hora da consulta. */
  referenceDate: referenceDateSchema.nullable(),
  variation: variationSchema,
  /**
   * A observação mais recente é mais antiga que o esperado para a
   * periodicidade da série. A interface sinaliza em vez de esconder.
   */
  stale: z.boolean(),
  isFavorite: z.boolean(),
});

/** Tela de detalhe: soma ao card a série histórica e os textos explicativos. */
export const indicatorDetailSchema = indicatorSummarySchema.extend({
  rationale: z.string().min(1),
  limitations: z.string().min(1),
  docUrl: z.string().url(),
  history: z.array(observationSchema),
  /** Variação de médio prazo, exibida ao lado da de curto prazo. */
  mediumTermVariation: variationSchema,
});

export const historyWindowSchema = z.enum(['30d', '90d', '1y', '5y']);

/** Query aceita pela rota de detalhe. */
export const indicatorDetailQuerySchema = z.object({
  window: historyWindowSchema.default('90d'),
});

export const favoriteMutationSchema = z.object({
  seriesId: z.string().min(1),
});

export const favoritesResponseSchema = z.object({
  seriesIds: z.array(z.string().min(1)),
});

/**
 * Erro devolvido ao cliente.
 *
 * Deliberadamente pobre em detalhe: `code` e `message` genéricos, sem stack
 * trace, sem query SQL e sem corpo da resposta da fonte externa. O detalhe
 * fica no log interno, correlacionado por `requestId`.
 */
export const errorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

export type ReferenceDate = z.infer<typeof referenceDateSchema>;
export type SeriesKind = z.infer<typeof seriesKindSchema>;
export type VariationUnit = z.infer<typeof variationUnitSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Frequency = z.infer<typeof frequencySchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Variation = z.infer<typeof variationSchema>;
export type IndicatorSummary = z.infer<typeof indicatorSummarySchema>;
export type IndicatorDetail = z.infer<typeof indicatorDetailSchema>;
export type HistoryWindow = z.infer<typeof historyWindowSchema>;
export type IndicatorDetailQuery = z.infer<typeof indicatorDetailQuerySchema>;
export type FavoriteMutation = z.infer<typeof favoriteMutationSchema>;
export type FavoritesResponse = z.infer<typeof favoritesResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Quantos dias de histórico cada janela pede à base. */
export const HISTORY_WINDOW_DAYS: Readonly<Record<HistoryWindow, number>> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  '5y': 1825,
};
