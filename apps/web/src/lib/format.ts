/**
 * Formatação para leitura humana, em pt-BR.
 *
 * Concentrada num módulo só e testada isoladamente, porque erro de formatação
 * num painel financeiro é indistinguível de erro de cálculo aos olhos do
 * usuário: quem vê "5.2005" onde deveria ler "5,2005" conclui que o sistema
 * está errado, e nesse contexto está mesmo.
 */

import type { SeriesKind, Variation } from '@pulse-fx/contracts';

/** Quantas casas decimais fazem sentido para cada natureza de série. */
const DECIMALS_BY_KIND: Readonly<Record<SeriesKind, number>> = {
  fx_daily: 4,
  policy_rate: 2,
  yield_daily: 2,
  macro_monthly_index: 3,
  macro_monthly_rate: 2,
};

export function formatValue(value: number | null, kind: SeriesKind): string {
  if (value === null) return '—';

  const digits = DECIMALS_BY_KIND[kind];
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** `2026-08-28` → `28/08/2026`, sem passar por `Date` para não deslocar fuso. */
export function formatDate(isoDate: string | null): string {
  if (!isoDate) return '—';

  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** `2026-07-01` → `julho de 2026`, para séries mensais. */
export function formatMonth(isoDate: string | null): string {
  if (!isoDate) return '—';

  const [year, month] = isoDate.split('-');
  const nomes = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];

  return `${nomes[Number(month) - 1] ?? month} de ${year}`;
}

export type VariationDirection = 'up' | 'down' | 'flat' | 'none';

export function variationDirection(variation: Variation): VariationDirection {
  if (variation.change === null) return 'none';
  if (variation.change > 0) return 'up';
  if (variation.change < 0) return 'down';
  return 'flat';
}

/**
 * Número da variação com sinal explícito e unidade correta.
 *
 * O sinal é parte da informação, não enfeite: é o que permite ler a direção
 * sem depender da cor — requisito de WCAG e simplesmente bom senso para quem
 * enxerga cores de forma diferente.
 */
export function formatVariation(variation: Variation): string {
  if (variation.change === null) return '—';

  const digits = variation.unit === 'percent' ? 2 : 2;
  const abs = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(variation.change));

  const sign = variation.change > 0 ? '+' : variation.change < 0 ? '−' : '';
  const unit = variation.unit === 'percent' ? '%' : ' p.p.';

  return `${sign}${abs}${unit}`;
}

/** Texto explicativo quando não há variação a mostrar. */
export function variationUnavailableText(variation: Variation): string {
  switch (variation.unavailableReason) {
    case 'no_observations':
      return 'Sem dados sincronizados para este indicador.';
    case 'no_baseline':
      return 'Ainda não há histórico suficiente para comparar.';
    case 'zero_baseline':
      return 'A base de comparação é zero: a variação percentual não é definida.';
    default:
      return '';
  }
}

/**
 * Frase completa da variação para leitor de tela.
 *
 * Um leitor de tela anunciando apenas "+0,70%" perde tanto a direção quanto a
 * referência da comparação. Esta função devolve a frase inteira.
 */
export function variationAriaLabel(variation: Variation): string {
  if (variation.change === null) return variationUnavailableText(variation);

  const direction = variation.change > 0 ? 'alta de' : variation.change < 0 ? 'queda de' : 'estável em';
  const magnitude = formatVariation(variation).replace(/^[+−]/, '');

  return `${direction} ${magnitude} ${variation.label}`;
}
