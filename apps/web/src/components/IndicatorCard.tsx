import type { IndicatorSummary } from '@pulse-fx/contracts';
import { Link } from 'react-router-dom';

import { formatDate, formatMonth, formatValue } from '../lib/format';
import { VariationBadge } from './VariationBadge';

interface Props {
  readonly indicator: IndicatorSummary;
  readonly index: number;
  readonly onToggleFavorite: (seriesId: string, next: boolean) => void;
  readonly pending?: boolean;
}

const SOURCE_LABEL: Record<IndicatorSummary['source'], string> = {
  bcb_sgs: 'Banco Central',
  fred: 'FRED · St. Louis Fed',
};

export function IndicatorCard({
  indicator,
  index,
  onToggleFavorite,
  pending = false,
}: Props): React.JSX.Element {
  // Série mensal se refere a um mês inteiro; mostrar "01/07/2026" sugeriria uma
  // precisão de dia que o dado não tem.
  const referenceLabel =
    indicator.frequency === 'monthly'
      ? formatMonth(indicator.referenceDate)
      : formatDate(indicator.referenceDate);

  return (
    <li className="card" style={{ '--stagger': index } as React.CSSProperties}>
      <div className="card-head">
        <div>
          <Link className="card-link" to={`/indicador/${indicator.id}`}>
            {indicator.name}
          </Link>
          <div className="card-source">{SOURCE_LABEL[indicator.source]}</div>
        </div>

        <button
          type="button"
          className="fav"
          aria-pressed={indicator.isFavorite}
          aria-label={
            indicator.isFavorite
              ? `Remover ${indicator.name} dos meus indicadores`
              : `Adicionar ${indicator.name} aos meus indicadores`
          }
          disabled={pending}
          onClick={() => {
            onToggleFavorite(indicator.id, !indicator.isFavorite);
          }}
        >
          <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"
              fill={indicator.isFavorite ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div>
        <div className="card-value">
          {formatValue(indicator.latestValue, indicator.kind)}
          <span className="card-unit">{indicator.unit}</span>
        </div>
      </div>

      <div className="card-foot">
        <VariationBadge variation={indicator.variation} />
        <span className="card-date">
          {referenceLabel}
          {indicator.stale && (
            <>
              {' '}
              <span className="badge-stale">
                <span aria-hidden="true">⚠</span> defasado
              </span>
            </>
          )}
        </span>
      </div>

      <span className="variation-label">{indicator.variation.label}</span>
    </li>
  );
}
