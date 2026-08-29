import type { Variation } from '@pulse-fx/contracts';

import {
  formatVariation,
  variationAriaLabel,
  variationDirection,
  variationUnavailableText,
} from '../lib/format';

/**
 * Indicador de variação.
 *
 * Três canais independentes comunicam a mesma informação — cor, seta e sinal
 * numérico. Nenhum é indispensável, o que atende ao critério da WCAG de não
 * usar cor como único meio de transmitir informação e, mais concretamente,
 * significa que alguém com deuteranopia lê o painel sem esforço.
 */
export function VariationBadge({ variation }: { variation: Variation }): React.JSX.Element {
  const direction = variationDirection(variation);

  if (variation.change === null) {
    return (
      <span className="variation variation--none" title={variationUnavailableText(variation)}>
        —<span className="sr-only">{variationUnavailableText(variation)}</span>
      </span>
    );
  }

  return (
    <span className={`variation variation--${direction}`}>
      {/* Seta decorativa: a informação está no sinal e no texto abaixo. */}
      {direction !== 'flat' && (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <path
            d={direction === 'up' ? 'M5 1L9 8H1z' : 'M5 9L1 2h8z'}
            fill="currentColor"
          />
        </svg>
      )}
      <span aria-hidden="true">{formatVariation(variation)}</span>
      <span className="sr-only">{variationAriaLabel(variation)}</span>
    </span>
  );
}
