/**
 * Tipos do domínio Pulse FX.
 *
 * Este módulo é puro: não conhece banco, HTTP nem framework. Toda a regra de
 * variação percentual vive aqui para que dashboard e tela de detalhe consumam
 * exatamente o mesmo cálculo — divergência entre as duas telas seria falha de
 * correção, não de layout.
 */

/** Data de referência da observação no calendário civil, em ISO `YYYY-MM-DD`. */
export type ReferenceDate = string;

/** Uma observação já persistida e considerada válida. */
export interface Observation {
  readonly referenceDate: ReferenceDate;
  readonly value: number;
}

/**
 * Natureza da série. Determina como a variação é calculada e em que unidade
 * ela é comunicada ao usuário.
 */
export type SeriesKind =
  /** Câmbio diário (PTAX). Publicado apenas em dias úteis. */
  | 'fx_daily'
  /** Taxa de política monetária (Selic meta, Fed Funds). Muda por decisão. */
  | 'policy_rate'
  /**
   * Juro de mercado com cotação diária (Treasury 10 anos). Diferente de
   * `policy_rate`: muda todo pregão, então o patamar anterior é o dia anterior.
   * Diferente de `fx_daily`: é taxa, logo varia em pontos percentuais.
   */
  | 'yield_daily'
  /**
   * Número-índice macro de periodicidade mensal (US CPI). O valor é um nível
   * (332,813), não uma taxa, então a leitura útil é a variação interanual em
   * porcentagem — que é exatamente a inflação acumulada em 12 meses.
   */
  | 'macro_monthly_index'
  /**
   * Taxa macro já expressa em porcentagem, de periodicidade mensal (IPCA, que
   * o SGS publica como variação percentual do mês, não como índice).
   *
   * Separado de `macro_monthly_index` por um erro real observado ao rodar o
   * sistema com dados de produção: tratar o IPCA como índice produzia
   * "−73,08%" no card, comparando 0,07% de julho/2026 com 0,26% de
   * julho/2025. Variação percentual de uma taxa percentual não tem significado
   * para o leitor — a comparação correta é em pontos percentuais.
   */
  | 'macro_monthly_rate';

/**
 * Unidade da variação.
 *
 * `percent` para preços e índices. `percentage_points` para taxas de juros:
 * dizer que uma Selic de 10% a.a. que sobe para 11% a.a. "subiu 10%" é
 * enganoso — o mercado lê essa mudança como +1 p.p.
 */
export type VariationUnit = 'percent' | 'percentage_points';

/**
 * Como localizar a observação de comparação.
 *
 * - `observations`: anda N posições para trás na série já persistida. Como as
 *   fontes só publicam em dia útil, andar N observações equivale a N dias úteis
 *   com dado disponível — resolve feriado, fim de semana e lacuna de publicação
 *   sem precisar de calendário de feriados, que difere entre Brasil e EUA.
 * - `calendar-months`: ancora no calendário e procura a observação de N meses
 *   antes. Correto para série mensal, onde a posição no array não garante a
 *   distância temporal se houver mês sem publicação.
 * - `last-distinct-value`: procura o patamar anterior, ignorando repetições.
 *   Necessário para taxa de política. Verificado contra a série 432 do SGS em
 *   28/08/2026: o BCB publica a Selic meta todos os dias, inclusive sábado e
 *   domingo, com o mesmo valor entre reuniões do Copom. Comparar com "a
 *   observação anterior" devolveria zero quase sempre; o que interessa ao
 *   usuário é a mudança em relação ao patamar anterior.
 */
export type LookbackStrategy = 'observations' | 'calendar-months' | 'last-distinct-value';

export interface VariationPolicy {
  readonly strategy: LookbackStrategy;
  readonly lookback: number;
  readonly unit: VariationUnit;
  /** Texto curto exibido junto do número, ex.: "vs. pregão anterior". */
  readonly label: string;
}

/**
 * Política padrão por tipo de série. Os valores de `lookback` são fixos e
 * justificados no README, como o briefing exige.
 */
export const DEFAULT_VARIATION_POLICY: Readonly<Record<SeriesKind, VariationPolicy>> = {
  fx_daily: {
    strategy: 'observations',
    lookback: 1,
    unit: 'percent',
    label: 'vs. pregão anterior',
  },
  policy_rate: {
    strategy: 'last-distinct-value',
    lookback: 1,
    unit: 'percentage_points',
    label: 'vs. patamar anterior',
  },
  yield_daily: {
    strategy: 'observations',
    lookback: 1,
    unit: 'percentage_points',
    label: 'vs. pregão anterior',
  },
  macro_monthly_index: {
    strategy: 'calendar-months',
    lookback: 12,
    unit: 'percent',
    label: 'vs. mesmo mês do ano anterior',
  },
  macro_monthly_rate: {
    strategy: 'calendar-months',
    lookback: 12,
    unit: 'percentage_points',
    label: 'vs. mesmo mês do ano anterior',
  },
};

/**
 * Janela alternativa de médio prazo, usada nos gráficos de detalhe.
 * 21 observações aproximam um mês de pregões sem misturar calendários.
 */
export const MEDIUM_TERM_POLICY: Readonly<Record<SeriesKind, VariationPolicy>> = {
  fx_daily: {
    strategy: 'observations',
    lookback: 21,
    unit: 'percent',
    label: 'vs. 21 pregões atrás',
  },
  policy_rate: {
    strategy: 'last-distinct-value',
    lookback: 4,
    unit: 'percentage_points',
    label: 'vs. 4 patamares atrás',
  },
  yield_daily: {
    strategy: 'observations',
    lookback: 21,
    unit: 'percentage_points',
    label: 'vs. 21 pregões atrás',
  },
  macro_monthly_index: {
    strategy: 'calendar-months',
    lookback: 1,
    unit: 'percent',
    label: 'vs. mês anterior',
  },
  macro_monthly_rate: {
    strategy: 'calendar-months',
    lookback: 1,
    unit: 'percentage_points',
    label: 'vs. mês anterior',
  },
};

/** Motivo pelo qual não foi possível calcular a variação. */
export type VariationUnavailableReason =
  /** A série não tem nenhuma observação válida. */
  | 'no_observations'
  /** Há observação atual, mas não existe base de comparação na janela pedida. */
  | 'no_baseline'
  /** A base de comparação é zero: divisão indefinida em variação percentual. */
  | 'zero_baseline';

export interface VariationResult {
  /** Observação mais recente válida. `null` quando a série está vazia. */
  readonly latest: Observation | null;
  /** Observação usada como denominador. `null` quando não há base. */
  readonly baseline: Observation | null;
  /** Valor da variação, já na unidade indicada. `null` se não calculável. */
  readonly change: number | null;
  readonly unit: VariationUnit;
  readonly label: string;
  /** Preenchido apenas quando `change` é `null`. */
  readonly unavailableReason: VariationUnavailableReason | null;
}
